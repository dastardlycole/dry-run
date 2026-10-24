import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JunctionStatsResponse } from '../../client/src/instructor/types';
import { buildApp } from './app';

// GET /api/junctions/stats against an in-memory MongoDB seeded with what Stream Processing and the
// STATS19 import would have written.

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const app = buildApp(async () => db);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db('test');
}, 300_000);

afterAll(async () => {
  await app.close();
  await client?.close();
  await mongod?.stop();
});

const since = new Date('2021-01-01T00:00:00Z');
const stat = (junctionId: string, ruleId: string, category: string, faults: number, lastUpdated: string) => ({
  _id: { centreId: 'wanstead', junctionId, ruleId, category },
  faults,
  lastUpdated: new Date(lastUpdated),
});
const fault = (n: number, sessionId: string, junctionId: string, ruleId: string, category = 'driving') => ({
  _id: `${sessionId}:${n}`,
  sessionId,
  centreId: 'wanstead',
  junctionId,
  ruleId,
  category,
});

beforeEach(async () => {
  await db.dropDatabase();
  await db.collection('junctions').insertMany([
    {
      _id: 'rbt' as never,
      centreId: 'wanstead',
      type: 'roundabout',
      name: 'A1008 / Cambridge Park',
      location: { type: 'Point', coordinates: [0.03, 51.58] },
      routeIds: ['demo', 'other'],
      collisions: { total: 4, serious: 1, fatal: 0, since },
    },
    {
      _id: 'lights' as never,
      centreId: 'wanstead',
      type: 'signals',
      name: 'High Street',
      location: { type: 'Point', coordinates: [0.02, 51.57] },
      routeIds: ['demo'],
      collisions: { total: 0, serious: 0, fatal: 0, since },
    },
    {
      _id: 'quiet' as never,
      centreId: 'wanstead',
      type: 'plain',
      name: 'Side Road',
      location: { type: 'Point', coordinates: [0.01, 51.56] },
      routeIds: [],
      collisions: { total: 0, serious: 0, fatal: 0, since },
    },
  ]);
  await db.collection<{ _id: object }>('junction_stats').insertMany([
    stat('rbt', 'R9', 'driving', 3, '2026-10-24T10:00:10Z'),
    stat('rbt', 'R4', 'driving', 2, '2026-10-24T10:00:20Z'),
    stat('lights', 'R1', 'serious', 1, '2026-10-24T10:00:30Z'),
    stat('lights', 'R1', 'driving', 2, '2026-10-24T10:00:30Z'),
  ]);
  await db.collection('fault_events').insertMany([
    fault(1, 's1', 'rbt', 'R9'),
    fault(2, 's1', 'rbt', 'R9'),
    fault(3, 's1', 'rbt', 'R4'),
    fault(1, 's2', 'rbt', 'R9'),
    fault(2, 's2', 'rbt', 'R4'),
    fault(1, 's3', 'lights', 'R1', 'serious'),
    fault(2, 's3', 'lights', 'R1'),
    fault(3, 's3', 'lights', 'R1'),
  ] as never[]);
  await db.collection('sessions').insertMany([
    { _id: 's1' as never, centreId: 'wanstead', routeId: 'demo' },
    { _id: 's2' as never, centreId: 'wanstead', routeId: 'demo' },
    { _id: 's3' as never, centreId: 'wanstead', routeId: 'demo' },
    { _id: 's4' as never, centreId: 'wanstead', routeId: 'demo' },
    { _id: 's5' as never, centreId: 'wanstead', routeId: 'other' },
  ]);
  await db.collection('collisions').insertMany([
    { _id: 'c1' as never, centreId: 'wanstead', date: since, severity: 'serious', location: { type: 'Point', coordinates: [0.03, 51.58] } },
    { _id: 'c2' as never, centreId: 'elsewhere', date: since, severity: 'slight', location: { type: 'Point', coordinates: [1, 52] } },
  ]);
});

const get = async (qs = '') => {
  const res = await app.inject({ method: 'GET', url: `/api/junctions/stats${qs}` });
  expect(res.statusCode).toBe(200);
  return res.json() as JunctionStatsResponse;
};
const byId = (r: JunctionStatsResponse) => Object.fromEntries(r.junctions.map((j) => [j.id, j]));

describe('GET /api/junctions/stats', () => {
  it('adds up faults per junction, by rule, with collisions', async () => {
    const r = await get();
    const j = byId(r);
    expect(Object.keys(j).sort()).toEqual(['lights', 'rbt']); // 'quiet' has nothing to show
    expect(j.rbt).toEqual({
      id: 'rbt',
      name: 'A1008 / Cambridge Park',
      type: 'roundabout',
      lng: 0.03,
      lat: 51.58,
      faults: 5,
      byRule: { R9: 3, R4: 2 },
      sessionsThrough: 5, // 4 on demo + 1 on other
      sessionsWithFault: 2,
      collisions: { total: 4, serious: 1, fatal: 0, since: since.toISOString() },
    });
    expect(j.lights).toMatchObject({ faults: 3, byRule: { R1: 3 }, sessionsThrough: 4, sessionsWithFault: 1 });
    expect(r.updatedAt).toBe('2026-10-24T10:00:30.000Z');
  });

  it('only returns collisions for this centre', async () => {
    expect((await get()).collisions).toEqual([
      { id: 'c1', lng: 0.03, lat: 51.58, severity: 'serious', date: since.toISOString() },
    ]);
  });

  it('filters by rule', async () => {
    const j = byId(await get('?ruleId=R9'));
    expect(j.rbt).toMatchObject({ faults: 3, byRule: { R9: 3 }, sessionsWithFault: 2 });
    expect(j.lights).toBeUndefined();
  });

  it('filters by category', async () => {
    const j = byId(await get('?category=serious'));
    expect(j.lights).toMatchObject({ faults: 1, byRule: { R1: 1 }, sessionsWithFault: 1 });
    expect(j.rbt).toMatchObject({ faults: 0, sessionsWithFault: 0 }); // still shown for its collisions
  });

  it('treats an empty filter as no filter, and rejects unknown values', async () => {
    expect(byId(await get('?ruleId=&category=')).rbt.faults).toBe(5);
    expect((await app.inject({ method: 'GET', url: '/api/junctions/stats?ruleId=R99' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/junctions/stats?category=minor' })).statusCode).toBe(400);
  });

  it('works on an empty database', async () => {
    await db.dropDatabase();
    expect(await get()).toEqual({ updatedAt: null, simulatedSessions: 0, junctions: [], collisions: [] });
  });
});
