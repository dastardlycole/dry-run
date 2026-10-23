import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FaultEvent } from '../../client/src/faults/types';
import { buildApp } from './app';
import { ensureIndexes } from './sessions';

// The session and fault endpoints against a throwaway in-memory MongoDB, so tests never touch Atlas.

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const app = buildApp(async () => db);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db('test');
}, 300_000); // the first run downloads a mongod

afterAll(async () => {
  await app.close();
  await client?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
});

const startedAt = '2026-10-24T10:00:00.000Z';
const start = (sessionId = 'sess-1') =>
  app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { sessionId, learnerId: 'learner-1', centreId: 'wanstead', routeId: 'demo', startedAt },
  });

const event = (n: number, category: FaultEvent['category'] = 'driving', over: Partial<FaultEvent> = {}): FaultEvent => ({
  _id: `sess-1:${n}`,
  sessionId: 'sess-1',
  learnerId: 'learner-1',
  centreId: 'wanstead',
  junctionId: 'osm-node-243757',
  ruleId: 'R4',
  category,
  ts: `2026-10-24T10:00:${String(n).padStart(2, '0')}.000Z`,
  location: { type: 'Point', coordinates: [0.0236, 51.5797] },
  speedMph: 24.5,
  context: { stepId: 's1' },
  ...over,
});
const send = (events: unknown[]) => app.inject({ method: 'POST', url: '/api/events', payload: { events } });
const end = (id = 'sess-1') =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/end`, payload: { endedAt: '2026-10-24T10:05:00.000Z' } });

describe('POST /api/sessions', () => {
  it('creates the session (and learner), and a repeat changes nothing', async () => {
    expect((await start()).json()).toEqual({ sessionId: 'sess-1' });
    expect((await start()).statusCode).toBe(200);
    const sessions = await db.collection('sessions').find().toArray();
    expect(sessions).toEqual([
      { _id: 'sess-1', learnerId: 'learner-1', centreId: 'wanstead', routeId: 'demo', startedAt: new Date(startedAt) },
    ]);
    expect(await db.collection('learners').countDocuments()).toBe(1);
  });

  it('rejects a bad body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sessions', payload: { sessionId: 'x', startedAt: 'yesterday' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/events', () => {
  beforeEach(async () => {
    await start();
  });

  it('saves a batch, with ts as a date', async () => {
    expect((await send([event(1), event(2)])).json()).toEqual({ inserted: 2, duplicates: 0 });
    const saved = await db.collection('fault_events').find().sort({ ts: 1 }).toArray();
    expect(saved.map((e) => e._id)).toEqual(['sess-1:1', 'sess-1:2']);
    expect(saved[0].ts).toEqual(new Date('2026-10-24T10:00:01.000Z'));
  });

  it('skips faults it already has when the client sends a batch again', async () => {
    await send([event(1), event(2)]);
    const res = await send([event(1), event(2), event(3)]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ inserted: 1, duplicates: 2 });
    expect(await db.collection('fault_events').countDocuments()).toBe(3);
  });

  it('takes learner and centre from the session, not the event', async () => {
    await send([event(1, 'driving', { learnerId: 'someone-else' })]);
    expect((await db.collection('fault_events').findOne())?.learnerId).toBe('learner-1');
  });

  it('asks the client to try again later for a session it has not seen yet', async () => {
    const res = await send([event(1, 'driving', { sessionId: 'sess-2', _id: 'sess-2:1' })]);
    expect(res.statusCode).toBe(409);
    expect(await db.collection('fault_events').countDocuments()).toBe(0);
  });

  it('rejects bad events', async () => {
    expect((await send([{ ...event(1), ruleId: 'R99' }])).statusCode).toBe(400);
    expect((await send([{ ...event(1), category: 'minor' }])).statusCode).toBe(400);
    expect((await send([{ ...event(1), location: { type: 'Point', coordinates: [0, 200] } }])).statusCode).toBe(400);
    expect((await send([{ ...event(1), extra: true }])).statusCode).toBe(400);
    expect((await send([])).statusCode).toBe(400);
  });

  it('works with the SPEC §7 indexes in place', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db); // safe to run again on the next start
    expect((await send([event(1)])).statusCode).toBe(200);
    const names = (await db.collection('fault_events').indexes()).map((i) => i.name);
    expect(names).toEqual(
      expect.arrayContaining(['location_2dsphere', 'centreId_1_junctionId_1_ruleId_1', 'sessionId_1_ts_1']),
    );
  });
});

describe('POST /api/sessions/:id/end', () => {
  beforeEach(async () => {
    await start();
  });

  it('passes with up to 15 driving faults', async () => {
    await send(Array.from({ length: 15 }, (_, i) => event(i + 1)));
    const res = (await end()).json();
    expect(res).toEqual({ sessionId: 'sess-1', result: 'PASS', counts: { driving: 15, serious: 0, dangerous: 0 } });
    const s = await db.collection('sessions').findOne({ _id: 'sess-1' as never });
    expect(s).toMatchObject({ result: 'PASS', endedAt: new Date('2026-10-24T10:05:00.000Z') });
  });

  it('fails with 16 driving faults, or one dangerous', async () => {
    await send(Array.from({ length: 16 }, (_, i) => event(i + 1)));
    expect((await end()).json().result).toBe('FAIL');
    await db.collection('fault_events').deleteMany({});
    await send([event(1, 'dangerous')]);
    expect((await end()).json()).toMatchObject({ result: 'FAIL', counts: { driving: 0, serious: 0, dangerous: 1 } });
  });

  it('counts from the saved faults: anything extra in the body is refused', async () => {
    await send([event(1, 'serious')]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/sess-1/end',
      payload: { endedAt: '2026-10-24T10:05:00.000Z', result: 'PASS' },
    });
    expect(res.statusCode).toBe(400);
    expect((await end()).json().result).toBe('FAIL');
  });

  it('is 404 for an unknown session', async () => {
    expect((await end('nope')).statusCode).toBe(404);
  });
});
