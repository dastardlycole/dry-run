import type { FastifyInstance } from 'fastify';
import { MongoBulkWriteError, type Db } from 'mongodb';
import { countFaults, resultOf, type Result } from '../../client/src/faults/result';
import type { FaultEvent } from '../../client/src/faults/types';

// Sessions and fault events (SPEC §7, §9 API). The client makes the session id itself, so a drive that
// started while the server was down can be saved later under the same id: every call here is safe to
// repeat. The result is always worked out again from the saved faults, never taken from the client.

export interface SessionDoc {
  _id: string;
  learnerId: string;
  centreId: string;
  routeId: string;
  startedAt: Date;
  endedAt?: Date;
  /** Reset part-way (R): result UNFINISHED and no examiner's summary, as the result screen is already gone. */
  abandoned?: boolean;
  result?: Result;
  counts?: { driving: number; serious: number; dangerous: number };
}

export type FaultEventDoc = Omit<FaultEvent, 'ts'> & { ts: Date };

export const MAX_EVENTS_PER_BATCH = 500;
export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R9', 'R11', 'R15'];

const id = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.:-]+$' };
const time = { type: 'string', format: 'date-time' };

const startBody = {
  type: 'object',
  required: ['sessionId', 'learnerId', 'centreId', 'routeId', 'startedAt'],
  additionalProperties: false,
  properties: { sessionId: id, learnerId: id, centreId: id, routeId: id, startedAt: time },
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
}

/** Told when faults are saved and when a test ends, so the debrief can be written in the background. */
export interface SessionHooks {
  faultsSaved?: (events: FaultEventDoc[]) => void;
  sessionEnded?: (sessionId: string) => void;
}

export function sessionRoutes(app: FastifyInstance, getDb: () => Promise<Db>, hooks: SessionHooks = {}) {
  const sessions = async () => (await getDb()).collection<SessionDoc>('sessions');
  const events = async () => (await getDb()).collection<FaultEventDoc>('fault_events');

  app.post<{ Body: { sessionId: string; learnerId: string; centreId: string; routeId: string; startedAt: string } }>(
    '/api/sessions',
    { schema: { body: startBody } },
    async (req) => {
      const { sessionId, learnerId, centreId, routeId, startedAt } = req.body;
      // A repeat (the client retrying) changes nothing.
      await (await sessions()).updateOne(
        { _id: sessionId },
        { $setOnInsert: { learnerId, centreId, routeId, startedAt: new Date(startedAt) } },
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
      if (!(await col.findOne({ _id: sessionId }))) return reply.code(404).send({ error: 'unknown session' });
      const saved = await (await events()).find({ sessionId }, { projection: { category: 1 } }).toArray();
      const counts = countFaults(saved);
      const abandoned = req.body.abandoned === true;
      // Only the sim knows if the route was driven to the end, so it has to say so: anything else (an old
      // client, a hand-made request) is UNFINISHED, never a pass. The faults are still counted here.
      const result = resultOf(counts, req.body.finished === true && !abandoned);
      await col.updateOne(
        { _id: sessionId },
        { $set: { endedAt: new Date(req.body.endedAt), result, counts, ...(abandoned ? { abandoned } : {}) } },
      );
      // No examiner's summary for a test reset part-way; one ended early still gets one.
      if (!abandoned) hooks.sessionEnded?.(sessionId);
      return { sessionId, result, counts };
    },
  );
}
