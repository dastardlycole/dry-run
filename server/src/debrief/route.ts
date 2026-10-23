import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import type { Citation, DebriefLine, JunctionFacts } from '../../../client/src/net/debrief';
import { sessionsPerRoute, sessionsThrough, sessionsWithFault, type JunctionDoc } from '../junction-stats';
import type { GuidanceChunk } from './check';
import { loadFaults, type Debriefer, type FaultDoc, type SavedSession } from './debriefer';

// GET /api/sessions/:id/debrief (SPEC §4.7 FR-D2–D5): the debrief so far, as NDJSON. One line per saved fault,
// sent as soon as it's ready (straight away if the background has already written it), then for an ended
// test the examiner's summary, then `done`. Works mid-drive too: that's the pause screen. Everything comes
// through the Debriefer, so a finished debrief is read back from fault_explanations rather than redone.

const id = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.:-]+$' };

export function debriefRoutes(app: FastifyInstance, getDb: () => Promise<Db>, debriefer: Debriefer) {
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/debrief',
    { schema: { params: { type: 'object', properties: { id } } } },
    async (req, reply) => {
      const db = await getDb();
      const session = await db.collection<SavedSession>('sessions').findOne({ _id: req.params.id });
      if (!session) return reply.code(404).send({ error: 'unknown session' });

      const faults = await loadFaults(db, session._id);
      const junctions = await junctionFacts(db, session.centreId, faults);
      // The guidance corpus is a few dozen chunks: one read serves every citation in the stream.
      let chunks: Promise<GuidanceChunk[]> | undefined;
      const citations = async (ids: string[]): Promise<Citation[]> => {
        if (!ids.length) return [];
        chunks ??= db.collection<GuidanceChunk>('guidance_chunks').find({}, { projection: { title: 1, url: 1 } }).toArray();
        const byId = new Map((await chunks).map((c) => [c._id, c]));
        return ids.flatMap((i) => {
          const c = byId.get(i);
          return c ? [{ id: c._id, title: c.title, url: c.url }] : [];
        });
      };

      async function* lines() {
        for await (const r of asCompleted(faults, (f) => debriefer.explain(f))) {
          yield json({
            kind: 'fault',
            faultId: r.fault._id,
            junction: junctions.get(r.fault.junctionId) ?? null,
            text: r.explanation?.text ?? null,
            citations: await citations(r.explanation?.guidanceChunkIds ?? []),
            temporary: !r.explanation && r.error,
          });
        }
        if (session!.endedAt) {
          const summary = await debriefer.finish(session!._id);
          if (summary) yield json({ kind: 'summary', text: summary.text, citations: await citations(summary.guidanceChunkIds) });
        }
        yield json({ kind: 'done', unavailable: !debriefer.available });
      }

      reply.type('application/x-ndjson').header('cache-control', 'no-store');
      return reply.send(Readable.from(lines()));
    },
  );
}

const json = (l: DebriefLine) => JSON.stringify(l) + '\n';

/** Results of `fn` over `items`, all started at once, in the order they finish. `fn` must not throw. */
export async function* asCompleted<T, R>(items: T[], fn: (t: T) => Promise<R>): AsyncGenerator<R> {
  const running = new Map(items.map((t, i) => [i, fn(t).then((r): [number, R] => [i, r])]));
  while (running.size) {
    const [i, r] = await Promise.race(running.values());
    running.delete(i);
    yield r;
  }
}

/** "N of M tests had a fault here" and the junction's STATS19 collisions (SPEC §4.7 FR-D4). */
async function junctionFacts(db: Db, centreId: string, faults: FaultDoc[]): Promise<Map<string, JunctionFacts>> {
  const ids = [...new Set(faults.map((f) => f.junctionId))];
  if (!ids.length) return new Map();
  const [docs, perRoute, withFault] = await Promise.all([
    db.collection<JunctionDoc>('junctions').find({ _id: { $in: ids } }).toArray(),
    sessionsPerRoute(db, centreId),
    sessionsWithFault(db, { centreId, junctionId: { $in: ids } }),
  ]);
  return new Map(
    docs.map((j) => [
      j._id,
      {
        name: j.name,
        sessionsThrough: sessionsThrough(j.routeIds, perRoute),
        sessionsWithFault: withFault.get(j._id) ?? 0,
        collisions: j.collisions?.total ?? 0,
        collisionsSince: j.collisions?.since ? j.collisions.since.toISOString() : null,
      },
    ]),
  );
}
