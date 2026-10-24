import type { FastifyInstance } from 'fastify';
import { MongoBulkWriteError, type Db } from 'mongodb';
import { countFaults, drivingFaultLimit, resultOf, type Result } from '../../client/src/faults/result';
import type { FaultEvent } from '../../client/src/faults/types';
import { weakJunctions, type FaultGroup } from '../../client/src/faults/weak';
import type { RouteStep } from '../../client/src/world/types';

// Sessions and fault events (SPEC §7, §9 API). The client makes the session id itself, so a drive that
// started while the server was down can be saved later under the same id: every call here is safe to
// repeat. The result is always worked out again from the saved faults, never taken from the client.

export interface SessionDoc {
  _id: string;
  learnerId: string;
  centreId: string;
  routeId: string;
  /** The route's length, which sets the driving fault limit (drivingFaultLimit). Missing on old sessions: 15. */
  routeLengthM?: number;
  /** A practice drive (row 17): saved like a test, but its result is always UNFINISHED, never a pass or fail. */
  mode?: 'practice' | 'free';
  startedAt: Date;
  endedAt?: Date;
  /** Reset part-way (R): result UNFINISHED and no examiner's summary, as the result screen is already gone. */
  abandoned?: boolean;
  result?: Result;
  counts?: { driving: number; serious: number; dangerous: number };
  /** The most driving faults this test allowed, saved with the result. */
  maxDrivingFaults?: number;
}

export type FaultEventDoc = Omit<FaultEvent, 'ts'> & { ts: Date };

export const MAX_EVENTS_PER_BATCH = 500;
export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R11', 'R15'];

const id = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.:-]+$' };
const time = { type: 'string', format: 'date-time' };

const startBody = {
  type: 'object',
  required: ['sessionId', 'learnerId', 'centreId', 'routeId', 'startedAt'],
  additionalProperties: false,
  properties: { sessionId: id, learnerId: id, centreId: id, routeId: id, mode: { enum: ['practice', 'free'] }, startedAt: time },
};

const eventSchema = {
  type: 'object',
  required: ['_id', 'sessionId', 'learnerId', 'centreId', 'junctionId', 'ruleId', 'category', 'ts', 'location', 'speedMph', 'context'],
  additionalProperties: false,
  properties: {
    _id: id,
    sessionId: id,
    learnerId: id,
    centreId: id,
    junctionId: id,
    ruleId: { enum: RULE_IDS },
    category: { enum: ['driving', 'serious', 'dangerous'] },
    ts: time,
    location: {
      type: 'object',
      required: ['type', 'coordinates'],
      additionalProperties: false,
      properties: {
        type: { const: 'Point' },
        coordinates: {
          type: 'array',
          items: [
            { type: 'number', minimum: -180, maximum: 180 },
            { type: 'number', minimum: -90, maximum: 90 },
          ],
          minItems: 2,
          maxItems: 2,
        },
      },
    },
    speedMph: { type: 'number', minimum: 0, maximum: 200 },
    context: { type: 'object', maxProperties: 20 },
  },
};

const eventsBody = {
  type: 'object',
  required: ['events'],
  additionalProperties: false,
  properties: { events: { type: 'array', minItems: 1, maxItems: MAX_EVENTS_PER_BATCH, items: eventSchema } },
};

const endBody = {
  type: 'object',
  required: ['endedAt'],
  additionalProperties: false,
  properties: { endedAt: time, finished: { type: 'boolean' }, abandoned: { type: 'boolean' } },
};

/** The fault_events indexes from SPEC §7. Safe to run on every start. */
export async function ensureIndexes(db: Db) {
  await db.collection('fault_events').createIndexes([
    { key: { location: '2dsphere' } },
    { key: { centreId: 1, junctionId: 1, ruleId: 1 } },
    { key: { sessionId: 1, ts: 1 } },
  ]);
  // A learner's latest drives at a centre (weak junctions).
  await db.collection('sessions').createIndex({ learnerId: 1, centreId: 1, startedAt: -1 });
}

/** Told when faults are saved and when a test ends, so the debrief can be written in the background. */
export interface SessionHooks {
  faultsSaved?: (events: FaultEventDoc[]) => void;
  sessionEnded?: (sessionId: string) => void;
  /** The route's length from its file, which sets the driving fault limit. Without it, the real 15. */
  routeLengthM?: (centreId: string, routeId: string) => number | undefined;
  /** A route's steps from its file, for which junctions a past drive went through. */
  routeSteps?: (centreId: string, routeId: string) => RouteStep[] | undefined;
}

/** How many of the learner's latest drives "your weak junctions" looks at. */
export const WEAK_DRIVES = 50;

export function sessionRoutes(app: FastifyInstance, getDb: () => Promise<Db>, hooks: SessionHooks = {}) {
  const sessions = async () => (await getDb()).collection<SessionDoc>('sessions');
  const events = async () => (await getDb()).collection<FaultEventDoc>('fault_events');

  app.post<{ Body: { sessionId: string; learnerId: string; centreId: string; routeId: string; mode?: SessionDoc['mode']; startedAt: string } }>(
    '/api/sessions',
    { schema: { body: startBody } },
    async (req) => {
      const { sessionId, learnerId, centreId, routeId, mode, startedAt } = req.body;
      // Looked up here, not sent by the client: the server works the result out for itself.
      const routeLengthM = hooks.routeLengthM?.(centreId, routeId);
      // A repeat (the client retrying) changes nothing.
      await (await sessions()).updateOne(
        { _id: sessionId },
        {
          $setOnInsert: {
            learnerId,
            centreId,
            routeId,
            ...(mode ? { mode } : {}),
            ...(routeLengthM ? { routeLengthM } : {}),
            startedAt: new Date(startedAt),
          },
        },
        { upsert: true },
      );
      await (await getDb())
        .collection<{ _id: string; createdAt: Date }>('learners')
        .updateOne({ _id: learnerId }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      return { sessionId };
    },
  );

  app.post<{ Body: { events: FaultEvent[] } }>('/api/events', { schema: { body: eventsBody } }, async (req, reply) => {
    const batch = req.body.events;
    const ids = [...new Set(batch.map((e) => e.sessionId))];
    const known = new Map((await (await sessions()).find({ _id: { $in: ids } }).toArray()).map((s) => [s._id, s]));
    const missing = ids.filter((s) => !known.has(s));
    // The client sends the session before its faults, so this is a retry that overtook it: try again later.
    if (missing.length) return reply.code(409).send({ error: 'unknown session', sessionIds: missing });
    // Learner and centre come from the session, not from each event.
    const docs: FaultEventDoc[] = batch.map((e) => {
      const s = known.get(e.sessionId)!;
      return { ...e, learnerId: s.learnerId, centreId: s.centreId, ts: new Date(e.ts) };
    });
    let duplicates = 0;
    try {
      await (await events()).insertMany(docs, { ordered: false });
    } catch (err) {
      // Faults already saved by an earlier try are skipped; anything else is a real error.
      if (!(err instanceof MongoBulkWriteError)) throw err;
      const errors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
      if (errors.some((w) => w.code !== 11000)) throw err;
      duplicates = errors.length;
    }
    hooks.faultsSaved?.(docs);
    return { inserted: docs.length - duplicates, duplicates };
  });

  app.post<{ Params: { id: string }; Body: { endedAt: string; finished?: boolean; abandoned?: boolean } }>(
    '/api/sessions/:id/end',
    { schema: { body: endBody, params: { type: 'object', properties: { id } } } },
    async (req, reply) => {
      const col = await sessions();
      const sessionId = req.params.id;
      const session = await col.findOne({ _id: sessionId });
      if (!session) return reply.code(404).send({ error: 'unknown session' });
      const saved = await (await events()).find({ sessionId }, { projection: { category: 1 } }).toArray();
      const counts = countFaults(saved);
      const abandoned = req.body.abandoned === true;
      // Only the sim knows if the route was driven to the end, so it has to say so: anything else (an old
      // client, a hand-made request) is UNFINISHED, never a pass. The faults are still counted here.
      // The pass mark scales with the route's length, as the sim's does.
      const maxDrivingFaults = drivingFaultLimit(session.routeLengthM);
      // A practice drive is never a test, so never a pass or fail.
      const result = resultOf(counts, req.body.finished === true && !abandoned && !session.mode, maxDrivingFaults);
      await col.updateOne(
        { _id: sessionId },
        { $set: { endedAt: new Date(req.body.endedAt), result, counts, maxDrivingFaults, ...(abandoned ? { abandoned } : {}) } },
      );
      // No examiner's summary for a test reset part-way; one ended early still gets one.
      if (!abandoned) hooks.sessionEnded?.(sessionId);
      return { sessionId, result, counts, maxDrivingFaults };
    },
  );

  // "Your weak junctions" (row 18): the learner's last drives on a route at this centre, and their faults
  // there grouped by junction and rule in Atlas. A drive reset part-way, or one still going, isn't counted.
  app.get<{ Params: { id: string }; Querystring: { centre: string } }>(
    '/api/learners/:id/weak-junctions',
    {
      schema: {
        params: { type: 'object', properties: { id } },
        querystring: { type: 'object', required: ['centre'], properties: { centre: id } },
      },
    },
    async (req) => {
      const learnerId = req.params.id;
      const centreId = req.query.centre;
      const drives = await (await sessions())
        .find(
          { learnerId, centreId, endedAt: { $exists: true }, abandoned: { $ne: true }, mode: { $ne: 'free' }, routeId: { $ne: 'free' } },
          { projection: { routeId: 1 }, sort: { startedAt: -1 }, limit: WEAK_DRIVES },
        )
        .toArray();
      const groups = await (await events())
        .aggregate<{ _id: Pick<FaultGroup, 'junctionId' | 'ruleId'>; sessionIds: string[]; missed: unknown[] }>([
          { $match: { learnerId, centreId, sessionId: { $in: drives.map((d) => d._id) } } },
          {
            $group: {
              _id: { junctionId: '$junctionId', ruleId: '$ruleId' },
              sessionIds: { $addToSet: '$sessionId' },
              // R7: which way the learner didn't look, each time (a look left missed once and a look right
              // once is still the same fault at the same junction).
              missed: { $push: '$context.missed' },
            },
          },
        ])
        .toArray();
      const junctions = weakJunctions(
        groups.map((g) => ({
          ...g._id,
          sessionIds: g.sessionIds,
          missed: [...new Set(g.missed.flatMap((m) => (Array.isArray(m) ? m.map(String) : [])))],
        })),
        drives.map((d) => ({ sessionId: d._id, routeId: d.routeId })),
        (routeId) => hooks.routeSteps?.(centreId, routeId),
      );
      return { drives: drives.length, junctions };
    },
  );
}
