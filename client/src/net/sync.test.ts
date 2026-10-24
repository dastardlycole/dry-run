import { describe, expect, it } from 'vitest';
import type { FaultEvent } from '../faults/types';
import { Sync } from './sync';

// The background queue, against a pretend server that can be switched off.

function fakeServer() {
  const calls: { url: string; body: any }[] = [];
  const server = {
    calls,
    up: true,
    /** Status to answer with instead of 200, once. */
    next: 0,
    fetch: (async (url: string, init: RequestInit) => {
      if (!server.up) throw new TypeError('Failed to fetch');
      const body = JSON.parse(init.body as string);
      const status = server.next || 200;
      server.next = 0;
      if (status === 200) calls.push({ url, body });
      const reply = url.endsWith('/end') ? { sessionId: 's', result: 'PASS', counts: { driving: 0, serious: 0, dangerous: 0 } } : {};
      return new Response(JSON.stringify(reply), { status });
    }) as typeof fetch,
  };
  return server;
}

const start = { sessionId: 's', learnerId: 'l', centreId: 'wanstead', routeId: 'demo', routeLengthM: 1988, startedAt: '2026-10-24T10:00:00.000Z' };
const fault = (n: number) => ({ _id: `s:${n}`, sessionId: 's' }) as FaultEvent;

describe('Sync', () => {
  it('sends the session, then its faults in one batch, then the end', async () => {
    const server = fakeServer();
    const sync = new Sync(server.fetch);
    let saved: unknown;
    sync.onSaved = (s) => (saved = s);
    sync.startSession(start);
    sync.addFault(fault(1));
    sync.addFault(fault(2));
    sync.endSession('s', '2026-10-24T10:05:00.000Z');
    await sync.flush();
    expect(server.calls.map((c) => c.url)).toEqual(['/api/sessions', '/api/events', '/api/sessions/s/end']);
    expect(server.calls[1].body.events.map((e: FaultEvent) => e._id)).toEqual(['s:1', 's:2']);
    expect(saved).toMatchObject({ result: 'PASS' });
    expect(sync.pendingFor('s')).toBe(false);
  });

  it('keeps everything queued while the server is down, and sends it in order when it is back', async () => {
    const server = fakeServer();
    const sync = new Sync(server.fetch);
    server.up = false;
    sync.startSession(start);
    sync.addFault(fault(1));
    await sync.flush();
    sync.addFault(fault(2));
    await sync.flush();
    expect(sync.state).toBe('offline');
    expect(sync.pendingFor('s')).toBe(true);
    server.up = true;
    await sync.flush();
    expect(server.calls.map((c) => c.url)).toEqual(['/api/sessions', '/api/events', '/api/events']);
    expect(sync.state).toBe('idle');
  });

  it('tries a batch again after a server error, and when the server has not seen the session yet', async () => {
    for (const status of [500, 409]) {
      const server = fakeServer();
      const sync = new Sync(server.fetch);
      sync.addFault(fault(1));
      server.next = status;
      await sync.flush();
      expect(server.calls).toEqual([]);
      await sync.flush();
      expect(server.calls.map((c) => c.url)).toEqual(['/api/events']);
    }
  });

  it("drops a session the server refuses to start, with its faults and end, so later sessions still go", async () => {
    const server = fakeServer();
    const sync = new Sync(server.fetch);
    const failed: string[] = [];
    sync.onFailed = (id) => failed.push(id);
    const err = console.error;
    console.error = () => {};
    sync.startSession(start);
    sync.addFault(fault(1));
    sync.endSession('s', '2026-10-24T10:05:00.000Z');
    sync.startSession({ ...start, sessionId: 't' });
    server.next = 400;
    await sync.flush();
    console.error = err;
    expect(failed).toEqual(['s']);
    expect(server.calls.map((c) => c.url)).toEqual(['/api/sessions']);
    expect(server.calls[0].body.sessionId).toBe('t');
    expect(sync.pendingFor('s')).toBe(false);
    expect(sync.state).toBe('idle');
    // The drive goes on: more faults for it are ignored, not left to block the queue.
    sync.addFault(fault(2));
    sync.endSession('s', '2026-10-24T10:06:00.000Z');
    expect(sync.pendingFor('s')).toBe(false);
  });

  it('says so when the server refuses the end, or its reply is unreadable', async () => {
    for (const bad of ['refused', 'unreadable'] as const) {
      const server = fakeServer();
      const send: typeof fetch = async (url, init) =>
        bad === 'unreadable' && String(url).endsWith('/end') ? new Response('<html>', { status: 200 }) : server.fetch(url, init);
      const sync = new Sync(send);
      const failed: string[] = [];
      sync.onFailed = (id) => failed.push(id);
      const err = console.error;
      console.error = () => {};
      sync.endSession('s', '2026-10-24T10:05:00.000Z');
      if (bad === 'refused') server.next = 404;
      await sync.flush();
      console.error = err;
      expect(failed).toEqual(['s']);
      expect(sync.state).toBe('idle');
    }
  });

  it('drops a call the server refuses as bad, so it does not block the rest', async () => {
    const server = fakeServer();
    const sync = new Sync(server.fetch);
    const err = console.error;
    console.error = () => {};
    sync.addFault(fault(1));
    server.next = 400;
    await sync.flush();
    console.error = err;
    sync.addFault(fault(2));
    await sync.flush();
    expect(server.calls.map((c) => c.body.events[0]._id)).toEqual(['s:2']);
  });

  it('a second flush while one is sending waits for it, instead of returning early', async () => {
    const server = fakeServer();
    const sync = new Sync(server.fetch);
    sync.startSession(start);
    sync.addFault(fault(1));
    const first = sync.flush();
    const second = sync.flush();
    expect(second).toBe(first);
    await second;
    expect(server.calls.map((c) => c.url)).toEqual(['/api/sessions', '/api/events']);
  });

  it('says how the test ended: reset part-way, ended early, or finished', async () => {
    const server = fakeServer();
    const sync = new Sync(server.fetch);
    sync.endSession('s', '2026-10-24T10:05:00.000Z', 'abandoned');
    sync.endSession('u', '2026-10-24T10:05:30.000Z', 'unfinished');
    sync.endSession('t', '2026-10-24T10:06:00.000Z');
    await sync.flush();
    expect(server.calls.map((c) => c.body)).toEqual([
      { endedAt: '2026-10-24T10:05:00.000Z', abandoned: true },
      { endedAt: '2026-10-24T10:05:30.000Z', finished: false },
      { endedAt: '2026-10-24T10:06:00.000Z', finished: true },
    ]);
  });
});
