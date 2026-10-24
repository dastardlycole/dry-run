import Fastify from 'fastify';
import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FaultEvent } from '../../client/src/faults/types';
import { buildApp } from './app';
import { ensureIndexes, sessionRoutes } from './sessions';

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
  app.inject({ method: 'POST', url: `/api/sessions/${id}/end`, payload: { endedAt: '2026-10-24T10:05:00.000Z', finished: true } });

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
    expect(res).toEqual({ sessionId: 'sess-1', result: 'PASS', counts: { driving: 15, serious: 0, dangerous: 0 }, maxDrivingFaults: 15 });
    const s = await db.collection('sessions').findOne({ _id: 'sess-1' as never });
    expect(s).toMatchObject({ result: 'PASS', endedAt: new Date('2026-10-24T10:05:00.000Z') });
  });

  it("scales the limit to the route's length, looked up by the server: 3 km allows 4", async () => {
    await db.dropDatabase();
    const short = Fastify();
    sessionRoutes(short, async () => db, { routeLengthM: (centreId, routeId) => (routeId === 'demo' ? 3000 : undefined) });
    const post = (url: string, payload: object) => short.inject({ method: 'POST', url, payload });
    await post('/api/sessions', { sessionId: 'sess-1', learnerId: 'learner-1', centreId: 'wanstead', routeId: 'demo', startedAt });
    const endShort = () => post('/api/sessions/sess-1/end', { endedAt: '2026-10-24T10:05:00.000Z', finished: true });
    await send(Array.from({ length: 4 }, (_, i) => event(i + 1)));
    expect((await endShort()).json()).toMatchObject({ result: 'PASS', maxDrivingFaults: 4 });
    await send([event(5)]);
    expect((await endShort()).json()).toMatchObject({ result: 'FAIL', maxDrivingFaults: 4 });
    expect(await db.collection('sessions').findOne({ _id: 'sess-1' as never })).toMatchObject({ routeLengthM: 3000, maxDrivingFaults: 4 });
    // A length the client sends is dropped: only the route's own file counts.
    await post('/api/sessions', { sessionId: 'sess-2', learnerId: 'learner-1', centreId: 'wanstead', routeId: 'demo', routeLengthM: 99_000, startedAt });
    expect(await db.collection('sessions').findOne({ _id: 'sess-2' as never })).toMatchObject({ routeLengthM: 3000 });
    await short.close();
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

  const endWith = (body: object) =>
    app.inject({ method: 'POST', url: '/api/sessions/sess-1/end', payload: { endedAt: '2026-10-24T10:05:00.000Z', ...body } });

  it('saves a test ended early (Enter) or reset part-way (R) as UNFINISHED, never PASS', async () => {
    // No flag at all (an old client, a hand-made request) is never taken as finished.
    for (const body of [{ finished: false }, { abandoned: true }, {}, { finished: true, abandoned: true }]) {
      expect((await endWith(body)).json()).toEqual({ sessionId: 'sess-1', result: 'UNFINISHED', counts: { driving: 0, serious: 0, dangerous: 0 }, maxDrivingFaults: 15 });
      expect(await db.collection('sessions').findOne({ _id: 'sess-1' as never })).toMatchObject({ result: 'UNFINISHED' });
    }
  });

  it('saves a practice drive with its mode, and never as a pass or fail', async () => {
    await db.dropDatabase();
    const payload = { sessionId: 'sess-1', learnerId: 'learner-1', centreId: 'wanstead', routeId: 'demo', mode: 'practice', startedAt };
    expect((await app.inject({ method: 'POST', url: '/api/sessions', payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/sessions', payload: { ...payload, mode: 'exam' } })).statusCode).toBe(400);
    expect((await endWith({ finished: true })).json()).toMatchObject({ result: 'UNFINISHED' });
    await send([event(1, 'dangerous')]);
    expect((await endWith({ finished: true })).json()).toMatchObject({ result: 'UNFINISHED', counts: { dangerous: 1 } });
    expect(await db.collection('sessions').findOne({ _id: 'sess-1' as never })).toMatchObject({ mode: 'practice' });
  });

  it('keeps the faults of an unfinished test', async () => {
    await send([event(1, 'serious')]);
    expect((await endWith({ finished: false })).json()).toMatchObject({ result: 'UNFINISHED', counts: { driving: 0, serious: 1, dangerous: 0 } });
  });

  it("asks for the examiner's summary after a finished or ended-early test, not after a reset", async () => {
    const ended: string[] = [];
    const hooked = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    sessionRoutes(hooked, async () => db, { sessionEnded: (id) => ended.push(id) });
    const endIt = (body: object) =>
      hooked.inject({ method: 'POST', url: '/api/sessions/sess-1/end', payload: { endedAt: '2026-10-24T10:05:00.000Z', ...body } });
    await endIt({ finished: true });
    await endIt({ finished: false });
    expect(ended).toEqual(['sess-1', 'sess-1']);
    await endIt({ abandoned: true });
    expect(ended).toHaveLength(2);
    await hooked.close();
  });

  it('is 404 for an unknown session', async () => {
    expect((await end('nope')).statusCode).toBe(404);
  });
});

describe('GET /api/learners/:id/weak-junctions', () => {
  const weak = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  sessionRoutes(weak, async () => db, {
    routeSteps: (centreId, routeId) =>
      centreId === 'wanstead' && routeId === 'demo'
        ? [{ junctionId: 'osm-node-243757', fromRoad: 'Hermon Hill', toRoad: 'High Street', action: 'left' } as never]
        : undefined,
  });
  afterAll(() => weak.close());

  /** A drive on the demo route with an R7 (missed the look right) at the junction, ended as `how`. */
  const drive = async (n: number, how: { finished?: boolean; abandoned?: boolean } | null, mode?: 'practice' | 'free', missed = ['right']) => {
    const sessionId = `sess-${n}`;
    await weak.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { sessionId, learnerId: 'learner-1', centreId: 'wanstead', routeId: mode === 'free' ? 'free' : 'demo', ...(mode ? { mode } : {}), startedAt },
    });
    const e = event(1, 'driving', { _id: `${sessionId}:1`, sessionId, ruleId: 'R7', context: { stepId: 's1', action: 'left', missed } });
    expect((await weak.inject({ method: 'POST', url: '/api/events', payload: { events: [e] } })).statusCode).toBe(200);
    if (how) await weak.inject({ method: 'POST', url: `/api/sessions/${sessionId}/end`, payload: { endedAt: startedAt, ...how } });
  };
  const get = (learner = 'learner-1') => weak.inject({ method: 'GET', url: `/api/learners/${learner}/weak-junctions?centre=wanstead` });

  it('has nothing for a learner with no drives', async () => {
    expect((await get()).json()).toEqual({ drives: 0, junctions: [] });
  });

  it("finds the junction where the same thing went wrong on two drives, counting only ended route drives", async () => {
    await drive(1, { finished: true });
    await drive(2, { finished: false }, 'practice');
    await drive(3, { finished: false });
    await drive(4, { abandoned: true }); // reset part-way: not counted
    await drive(5, null); // still going: not counted
    await drive(6, { finished: false }, 'free'); // no route: not counted
    expect((await get()).json()).toEqual({
      drives: 3,
      junctions: [
        { junctionId: 'osm-node-243757', name: 'Hermon Hill / High Street', what: 'missed the look right', times: 3, drives: 3, routeId: 'demo' },
      ],
    });
    expect((await get('learner-2')).json()).toEqual({ drives: 0, junctions: [] });
  });

  it('counts a missed look at the same junction as one fault, whichever way was missed', async () => {
    await drive(1, { finished: true }, undefined, ['left']);
    await drive(2, { finished: true }, undefined, ['right']);
    expect((await get()).json().junctions).toMatchObject([{ what: "didn't look both ways", times: 2, drives: 2 }]);
  });

  it('needs a centre', async () => {
    expect((await weak.inject({ method: 'GET', url: '/api/learners/learner-1/weak-junctions' })).statusCode).toBe(400);
  });
});
