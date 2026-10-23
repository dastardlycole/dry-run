import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import type { CollisionPoint, JunctionStat, JunctionStatsResponse, Severity } from '../../client/src/instructor/types';
import { env } from './env';
import { RULE_IDS } from './sessions';

// GET /api/junctions/stats (SPEC §4.8 FR-I1/I2, §4.7 FR-D4): per-junction fault counts from junction_stats
// (written by Stream Processing) and STATS19 collisions, ready for the map.
// "Sessions through" a junction is worked out here: sessions on each route × the routes that pass the junction.

interface StatDoc {
  _id: { centreId: string; junctionId: string; ruleId: string; category: string };
  faults: number;
  lastUpdated?: Date;
}

interface JunctionDoc {
  _id: string;
  type: string;
  name: string;
  location: { coordinates: [number, number] };
  routeIds?: string[];
  collisions?: { total: number; serious: number; fatal: number; since: Date | null };
}

const query = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ruleId: { enum: [...RULE_IDS, ''] },
    category: { enum: ['driving', 'serious', 'dangerous', ''] },
  },
};

export function junctionStatsRoutes(app: FastifyInstance, getDb: () => Promise<Db>) {
  app.get<{ Querystring: { ruleId?: string; category?: string } }>(
    '/api/junctions/stats',
    { schema: { querystring: query } },
    async (req): Promise<JunctionStatsResponse> => {
      const { ruleId, category } = req.query;
      const db = await getDb();
      const centreId = env.centreId;

      const statFilter: Record<string, string> = { '_id.centreId': centreId };
      const eventFilter: Record<string, string> = { centreId };
      if (ruleId) statFilter['_id.ruleId'] = eventFilter.ruleId = ruleId;
      if (category) statFilter['_id.category'] = eventFilter.category = category;

      const [stats, latest, faultedSessions, routeSessions, collisions] = await Promise.all([
        db.collection<StatDoc>('junction_stats').find(statFilter).toArray(),
        db.collection<StatDoc>('junction_stats').find({ '_id.centreId': centreId }).sort({ lastUpdated: -1 }).limit(1).toArray(),
        db
          .collection('fault_events')
          .aggregate<{ _id: string; n: number }>([
            { $match: eventFilter },
            { $group: { _id: { j: '$junctionId', s: '$sessionId' } } },
            { $group: { _id: '$_id.j', n: { $sum: 1 } } },
          ])
          .toArray(),
        db
          .collection('sessions')
          .aggregate<{ _id: string; n: number }>([{ $match: { centreId } }, { $group: { _id: '$routeId', n: { $sum: 1 } } }])
          .toArray(),
        db
          .collection<{ _id: string; date: Date; severity: Severity; location: { coordinates: [number, number] } }>('collisions')
          .find({ centreId }, { projection: { date: 1, severity: 1, location: 1 } })
          .toArray(),
      ]);

      const faults = new Map<string, { faults: number; byRule: Record<string, number> }>();
      for (const s of stats) {
        const f = faults.get(s._id.junctionId) ?? { faults: 0, byRule: {} };
        f.faults += s.faults;
        f.byRule[s._id.ruleId] = (f.byRule[s._id.ruleId] ?? 0) + s.faults;
        faults.set(s._id.junctionId, f);
      }
      const withFault = new Map(faultedSessions.map((x) => [x._id, x.n]));
      const perRoute = new Map(routeSessions.map((x) => [x._id, x.n]));

      const junctionDocs = await db
        .collection<JunctionDoc>('junctions')
        .find({ centreId, $or: [{ _id: { $in: [...faults.keys()] } }, { 'collisions.total': { $gt: 0 } }] })
        .toArray();

      const junctions: JunctionStat[] = junctionDocs.map((j) => {
        const f = faults.get(j._id);
        const c = j.collisions;
        return {
          id: j._id,
          name: j.name,
          type: j.type,
          lng: j.location.coordinates[0],
          lat: j.location.coordinates[1],
          faults: f?.faults ?? 0,
          byRule: f?.byRule ?? {},
          sessionsThrough: (j.routeIds ?? []).reduce((n, r) => n + (perRoute.get(r) ?? 0), 0),
          sessionsWithFault: withFault.get(j._id) ?? 0,
          collisions: {
            total: c?.total ?? 0,
            serious: c?.serious ?? 0,
            fatal: c?.fatal ?? 0,
            since: c?.since ? c.since.toISOString() : null,
          },
        };
      });

      const points: CollisionPoint[] = collisions.map((c) => ({
        id: c._id,
        lng: c.location.coordinates[0],
        lat: c.location.coordinates[1],
        severity: c.severity,
        date: c.date.toISOString(),
      }));

      return { updatedAt: latest[0]?.lastUpdated?.toISOString() ?? null, junctions, collisions: points };
    },
  );
}
