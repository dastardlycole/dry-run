import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaultEvent } from '../../../client/src/faults/types';
import type { DebriefLine } from '../../../client/src/net/debrief';
import { buildApp } from '../app';
import type { DebriefAI, ExplainRequest, SummaryRequest } from './argon';
import type { GuidanceChunk } from './check';
import { MAX_ACTIVE } from './debriefer';
import type { FindGuidance } from './retrieve';
import { asCompleted } from './route';

// The background debrief and its endpoint against an in-memory MongoDB, with a fake vector search (it has no
// $vectorSearch) and a fake Argon that answers from a script, so the verification loop runs without Gemini.

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

type Answer = unknown | Error;
/** What the fake Argon says: per fault id (and 'summary'), one answer per try. */
let script: Record<string, Answer[]> = {};
let explainCalls: ExplainRequest[] = [];
let summaryCalls: SummaryRequest[] = [];
/** How long each fake call takes, and the most running at once. */
let delayMs = 0;
let running = 0;
let mostRunning = 0;

const answer = async (key: string, n: number) => {
  running++;
  mostRunning = Math.max(mostRunning, running);
  await new Promise((r) => setTimeout(r, delayMs));
  running--;
  const a = (script[key] ?? [])[n - 1];
  if (a instanceof Error) throw a;
  return a;
};
const ai: DebriefAI = {
  explain: (r) => {
    explainCalls.push(r);
    return answer(r.fault._id, explainCalls.filter((c) => c.fault._id === r.fault._id).length);
  },
  summarise: (r) => {
    summaryCalls.push(r);
    return answer('summary', summaryCalls.length);
  },
};
// Stand-in for $vectorSearch: every chunk tagged with the fault's rule.
const findGuidance = (d: Db): FindGuidance => (f) => d.collection<GuidanceChunk>('guidance_chunks').find({ ruleIds: f.ruleId }).toArray();

const app = buildApp(async () => db, { debrief: { findGuidance, ai } });
const noGemini = buildApp(async () => db);
/** Fake TTS: the "audio" is the text it was given, so tests can see what was voiced. */
let spoken: string[] = [];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db('test');
}, 300_000);

afterAll(async () => {
  await app.close();
  await noGemini.close();
  await client?.close();
  await mongod?.stop();
});

const chunk = (id: string, ruleIds: string[]): GuidanceChunk => ({
  _id: id,
  source: 'The Highway Code',
  url: `https://www.gov.uk/x#${id}`,
  title: `Rule ${id}`,
  text: 'Use your mirrors.',
  ruleIds,
});
const event = (n: number, ruleId: FaultEvent['ruleId'] = 'R4'): FaultEvent => ({
  _id: `sess-1:${n}`,
  sessionId: 'sess-1',
  learnerId: 'learner-1',
  centreId: 'wanstead',
  junctionId: 'osm-node-1',
  ruleId,
  category: 'driving',
  ts: `2026-10-24T10:00:${String(n).padStart(2, '0')}.000Z`,
  location: { type: 'Point', coordinates: [0.02, 51.58] },
  speedMph: 20,
  context: {},
});
const good = (faultId: string, ids = ['hc-161']) => ({ faultId, text: `About ${faultId}.`, guidanceChunkIds: ids });
const goodSummary = { text: 'Work on your mirrors.', guidanceChunkIds: ['hc-161'] };

const startSession = (a = app) =>
  a.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { sessionId: 'sess-1', learnerId: 'learner-1', centreId: 'wanstead', routeId: 'demo', startedAt: '2026-10-24T10:00:00.000Z' },
  });
const saveFaults = (events: FaultEvent[], a = app) => a.inject({ method: 'POST', url: '/api/events', payload: { events } });
const endSession = (a = app) => a.inject({ method: 'POST', url: '/api/sessions/sess-1/end', payload: { endedAt: '2026-10-24T10:10:00.000Z', finished: true } });
const get = async (a = app, id = 'sess-1') => {
  const res = await a.inject({ method: 'GET', url: `/api/sessions/${id}/debrief` });
  const lines = res.statusCode === 200 ? res.payload.trim().split('\n').map((l) => JSON.parse(l) as DebriefLine) : [];
  return { res, lines, faults: lines.filter((l) => l.kind === 'fault'), summary: lines.find((l) => l.kind === 'summary') };
};
const explained = () => db.collection('fault_explanations').countDocuments();
const savedSession = () => db.collection<{ _id: string; debrief?: unknown; summary?: unknown }>('sessions').findOne({ _id: 'sess-1' });

beforeEach(async () => {
  await db.dropDatabase();
  script = {};
  explainCalls = [];
  summaryCalls = [];
  delayMs = 0;
  running = mostRunning = 0;
  spoken = [];
  await db.collection<GuidanceChunk>('guidance_chunks').insertMany([chunk('hc-161', ['R3', 'R4']), chunk('hc-175', ['R2'])]);
  await db.collection<{ _id: string }>('junctions').insertOne({
    _id: 'osm-node-1',
    centreId: 'wanstead',
    name: 'Eastern Avenue roundabout',
    routeIds: ['demo'],
    collisions: { total: 14, serious: 2, fatal: 0, since: new Date('2020-01-04T00:00:00Z') },
  } as never);
  await startSession();
});

describe('background debrief while driving', () => {
  it('explains each fault as soon as it is saved, without anyone asking', async () => {
    script = { 'sess-1:1': [good('sess-1:1')], 'sess-1:2': [good('sess-1:2')] };
    await saveFaults([event(1), event(2, 'R3')]);
    await vi.waitFor(async () => expect(await explained()).toBe(2));
    // Argon was only shown chunks for the fault's rule, and told where it happened.
    expect(explainCalls[0].chunks.map((c) => c._id)).toEqual(['hc-161']);
    expect(explainCalls[0].place).toBe('Eastern Avenue roundabout');
  });

  it('mid-drive (the pause screen): what is ready comes straight back, with no second Argon call', async () => {
    script = { 'sess-1:1': [good('sess-1:1')] };
    await saveFaults([event(1)]);
    await vi.waitFor(async () => expect(await explained()).toBe(1));
    const { faults, summary, lines } = await get();
    expect(explainCalls).toHaveLength(1);
    expect(faults).toEqual([
      {
        kind: 'fault',
        faultId: 'sess-1:1',
        text: 'About sess-1:1.',
        citations: [{ id: 'hc-161', title: 'Rule hc-161', url: 'https://www.gov.uk/x#hc-161' }],
        junction: { name: 'Eastern Avenue roundabout', sessionsThrough: 1, simulatedThrough: 0, sessionsWithFault: 1, collisions: 14, collisionsSince: '2020-01-04T00:00:00.000Z' },
        temporary: false,
      },
    ]);
    expect(summary).toBeUndefined(); // no summary until the test ends
    expect(lines.at(-1)).toEqual({ kind: 'done', unavailable: false });
  });

  it('asking while a fault is still being written waits for that same call', async () => {
    delayMs = 50;
    script = { 'sess-1:1': [good('sess-1:1')] };
    await saveFaults([event(1)]);
    const { faults } = await get();
    expect(faults[0]).toMatchObject({ text: 'About sess-1:1.' });
    expect(explainCalls).toHaveLength(1);
  });

  it(`runs at most ${MAX_ACTIVE} Argon calls at once`, async () => {
    delayMs = 30;
    const events = [1, 2, 3, 4, 5, 6, 7].map((n) => event(n));
    script = Object.fromEntries(events.map((e) => [e._id, [good(e._id)]]));
    await saveFaults(events);
    await vi.waitFor(async () => expect(await explained()).toBe(7));
    expect(mostRunning).toBe(MAX_ACTIVE);
  });

  it('tries once more with the checker’s reasons, and keeps a good second answer', async () => {
    script = { 'sess-1:1': [good('sess-1:1', ['hc-175']), good('sess-1:1')] };
    await saveFaults([event(1)]);
    const { faults } = await get();
    expect(faults[0]).toMatchObject({ text: 'About sess-1:1.' });
    expect(explainCalls[1].problems).toEqual(['"hc-175" was not one of the guidance chunks you were given']);
  });

  it('drops an explanation that fails the check twice, and keeps it dropped', async () => {
    script = { 'sess-1:1': [good('sess-1:1', ['hc-999']), { ...good('sess-1:1'), faultId: 'sess-1:2' }] };
    await saveFaults([event(1)]);
    expect((await get()).faults[0]).toMatchObject({ text: null, citations: [] });
    expect(explainCalls).toHaveLength(2);
    await get();
    expect(explainCalls).toHaveLength(2);
  });

  it('a failed call is not kept, is marked temporary, and asking again tries again', async () => {
    script = { 'sess-1:1': [new Error('timeout'), new Error('timeout'), good('sess-1:1')] };
    await saveFaults([event(1)]);
    expect((await get()).faults[0]).toMatchObject({ text: null, temporary: true });
    expect(await explained()).toBe(0);
    expect((await get()).faults[0]).toMatchObject({ text: 'About sess-1:1.', temporary: false });
  });

  it('a timeout then one rejected answer is not dropped for good: it gets its full second chance later', async () => {
    script = { 'sess-1:1': [new Error('timeout'), good('sess-1:1', ['hc-999']), good('sess-1:1')] };
    await saveFaults([event(1)]);
    expect((await get()).faults[0]).toMatchObject({ text: null, temporary: true });
    expect(await explained()).toBe(0);
    expect((await get()).faults[0].text).toBe('About sess-1:1.');
  });
});

describe('end of the test', () => {
  it('writes the examiner’s summary in the background and saves the whole debrief on the session', async () => {
    script = { 'sess-1:1': [good('sess-1:1')], 'sess-1:2': [good('sess-1:2')], summary: [goodSummary] };
    await saveFaults([event(1), event(2, 'R3')]);
    await endSession();
    await vi.waitFor(async () => expect((await savedSession())?.summary).toEqual(goodSummary));
    expect((await savedSession())?.debrief).toEqual([good('sess-1:1'), good('sess-1:2')]);
    // The summary saw the result, every fault with its explanation, and only the chunks those cited.
    expect(summaryCalls[0]).toMatchObject({ result: 'PASS', counts: { driving: 2, serious: 0, dangerous: 0 } });
    expect(summaryCalls[0].faults.map((f) => f.explanation?.text)).toEqual(['About sess-1:1.', 'About sess-1:2.']);
    expect(summaryCalls[0].chunks.map((c) => c._id)).toEqual(['hc-161']);

    const before = explainCalls.length;
    const { faults, summary, lines } = await get();
    expect(explainCalls.length + summaryCalls.length).toBe(before + 1);
    // In the order they're ready, which can be either.
    expect(faults.map((l) => l.faultId).sort()).toEqual(['sess-1:1', 'sess-1:2']);
    expect(summary).toEqual({ kind: 'summary', text: 'Work on your mirrors.', citations: [{ id: 'hc-161', title: 'Rule hc-161', url: 'https://www.gov.uk/x#hc-161' }] });
    expect(lines.at(-1)).toEqual({ kind: 'done', unavailable: false });
  });

  it('a summary citing a chunk no explanation used is sent back once, then dropped', async () => {
    script = { 'sess-1:1': [good('sess-1:1')], summary: [{ ...goodSummary, guidanceChunkIds: ['hc-175'] }, { ...goodSummary, guidanceChunkIds: [] }] };
    await saveFaults([event(1)]);
    await endSession();
    const { summary, faults } = await get();
    expect(summary).toBeUndefined();
    expect(faults[0].text).toBe('About sess-1:1.');
    expect(summaryCalls).toHaveLength(2);
    expect(summaryCalls[1].problems).toEqual(['"hc-175" was not one of the guidance chunks you were given']);
  });

  it('a test reset part-way (abandoned) gets no summary, but its faults keep their explanations', async () => {
    script = { 'sess-1:1': [good('sess-1:1')], summary: [goodSummary] };
    await saveFaults([event(1)]);
    await app.inject({ method: 'POST', url: '/api/sessions/sess-1/end', payload: { endedAt: '2026-10-24T10:01:00.000Z', abandoned: true } });
    const { faults, summary } = await get();
    expect(faults[0].text).toBe('About sess-1:1.');
    expect(summary).toBeUndefined();
    expect(summaryCalls).toHaveLength(0);
    expect((await savedSession()) as unknown).toMatchObject({ abandoned: true });
  });

  it('once finished, ending again (a retried request) asks Argon for nothing more', async () => {
    script = { 'sess-1:1': [good('sess-1:1')], summary: [{ ...goodSummary, guidanceChunkIds: [] }, { ...goodSummary, guidanceChunkIds: [] }] };
    await saveFaults([event(1)]);
    await endSession();
    await vi.waitFor(async () => expect((await savedSession())?.debrief).toBeDefined());
    expect(summaryCalls).toHaveLength(2);
    await endSession();
    await get();
    expect(summaryCalls).toHaveLength(2);
    expect(explainCalls).toHaveLength(1);
  });

  it('a test with no faults is just done', async () => {
    await endSession();
    expect((await get()).lines).toEqual([{ kind: 'done', unavailable: false }]);
    expect(summaryCalls).toHaveLength(0);
  });
});

describe('GET /api/sessions/:id/debrief', () => {
  it('without Gemini: junction facts only, marked unavailable, and nothing is written', async () => {
    await saveFaults([event(1)], noGemini);
    const { lines, faults } = await get(noGemini);
    expect(faults[0]).toMatchObject({ text: null, temporary: true, junction: { collisions: 14 } });
    expect(lines.at(-1)).toEqual({ kind: 'done', unavailable: true });
    expect(await explained()).toBe(0);
  });

  it('404 for an unknown session', async () => {
    expect((await get(app, 'nope')).res.statusCode).toBe(404);
  });
});

describe('GET /api/sessions/:id/summary-audio', () => {
  // A new app each time: clips are kept in memory, by session id.
  let withVoice: ReturnType<typeof buildApp>;
  beforeEach(() => {
    withVoice = buildApp(async () => db, {
      debrief: { findGuidance, ai },
      speak: async (text) => (spoken.push(text), Buffer.from(`RIFF:${text}`)),
    });
  });
  afterEach(() => withVoice.close());
  const audio = (a: ReturnType<typeof buildApp> = withVoice, sid = 'sess-1') => a.inject({ method: 'GET', url: `/api/sessions/${sid}/summary-audio` });

  it('voices the summary as soon as the test ends, once, and serves it as WAV', async () => {
    script = { 'sess-1:1': [good('sess-1:1')], summary: [goodSummary] };
    await saveFaults([event(1)], withVoice);
    await endSession(withVoice);
    await vi.waitFor(() => expect(spoken).toEqual(['Work on your mirrors.']));
    const res = await audio();
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/wav');
    expect(res.payload).toBe('RIFF:Work on your mirrors.');
    await audio();
    expect(spoken).toHaveLength(1);
  });

  it('404 when there is no summary (no faults, or not ended), and asking again later can still work', async () => {
    expect((await audio()).statusCode).toBe(404);
    expect((await audio(withVoice, 'nope')).statusCode).toBe(404);
    script = { 'sess-1:1': [good('sess-1:1')], summary: [goodSummary] };
    await saveFaults([event(1)], withVoice);
    await endSession(withVoice);
    expect((await audio()).statusCode).toBe(200);
  });

  it('503 without Gemini TTS', async () => {
    expect((await audio(app)).statusCode).toBe(503);
  });
});

describe('asCompleted', () => {
  it('starts everything at once and yields in the order they finish', async () => {
    const order: number[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for await (const n of asCompleted([30, 10, 5, 50], async (ms: number) => (await wait(ms), ms))) order.push(n);
    expect(order).toEqual([5, 10, 30, 50]);
  });
});
