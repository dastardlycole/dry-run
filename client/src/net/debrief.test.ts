import { describe, expect, it, vi } from 'vitest';
import { LineSplitter, streamDebrief, type DebriefLine } from './debrief';

const fault = (faultId: string): DebriefLine => ({ kind: 'fault', faultId, junction: null, text: `About ${faultId}`, citations: [], temporary: false });
const done: DebriefLine = { kind: 'done', unavailable: false };

/** A response whose body arrives in the given pieces. */
const streamed = (pieces: string[], status = 200) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const p of pieces) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    }),
    { status },
  );

describe('LineSplitter', () => {
  it('joins lines cut across pieces and keeps the unfinished end', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(':2}\n\n{"c"')).toEqual(['{"b":2}']);
    expect(s.push(':3}')).toEqual([]);
    expect(s.end()).toEqual(['{"c":3}']);
    expect(s.end()).toEqual([]);
  });
});

describe('streamDebrief', () => {
  it('hands over each line as it arrives, even split mid-line, and finishes on done', async () => {
    const text = [fault('s:1'), fault('s:2'), done].map((l) => JSON.stringify(l) + '\n').join('');
    const send = vi.fn(async () => streamed([text.slice(0, 17), text.slice(17, 60), text.slice(60)]));
    const got: DebriefLine[] = [];
    expect(await streamDebrief('s', (l) => got.push(l), undefined, send as never)).toBe(true);
    expect(got).toEqual([fault('s:1'), fault('s:2'), done]);
    expect(send).toHaveBeenCalledWith('/api/sessions/s/debrief', expect.anything());
  });

  it('tries again after a 409 or a dropped stream, without repeating faults already shown', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(streamed([JSON.stringify(fault('s:1')) + '\n'])) // ends before done
      .mockResolvedValueOnce(streamed([[fault('s:1'), fault('s:2'), done].map((l) => JSON.stringify(l)).join('\n')]));
    const got: DebriefLine[] = [];
    const p = streamDebrief('s', (l) => got.push(l), undefined, send);
    await vi.runAllTimersAsync();
    expect(await p).toBe(true);
    expect(got.map((l) => (l.kind === 'fault' ? l.faultId : l.kind))).toEqual(['s:1', 's:2', 'done']);
    vi.useRealTimers();
  });

  it('gives up on 404, and after a few failures', async () => {
    expect(await streamDebrief('s', () => {}, undefined, (async () => new Response('', { status: 404 })) as never)).toBe(false);
    vi.useFakeTimers();
    const send = vi.fn(async () => {
      throw new TypeError('offline');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = streamDebrief('s', () => {}, undefined, send as never);
    await vi.runAllTimersAsync();
    expect(await p).toBe(false);
    expect(send).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
