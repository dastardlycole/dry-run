import type { CollisionSummary } from '../../../client/src/instructor/types';
import type { Junction, Route, Vec2, WorldData } from '../../../client/src/world/types';
import type { CollisionRow } from '../stats19/parse';

// junctions docs (SPEC §7) from world.json, plus the link from each STATS19 collision to its nearest junction.

/** Collisions further than this from every junction aren't linked to one. */
export const NEAREST_MAX_M = 50;
/** A junction this close to a route's driving line counts as passed by that route. */
export const ROUTE_PASS_M = 25;

export interface JunctionDoc {
  _id: string;
  centreId: string;
  type: string;
  name: string;
  location: { type: 'Point'; coordinates: [lng: number, lat: number] };
  geometryConfidence: string;
  /** Routes that pass this junction, for "X% of learners get a fault here". */
  routeIds: string[];
  collisions: Omit<CollisionSummary, 'since'> & { since: Date | null };
}

export function nearestJunction(pos: Vec2, junctions: Pick<Junction, 'id' | 'pos'>[], maxM = NEAREST_MAX_M) {
  let best: { id: string; distM: number } | null = null;
  for (const j of junctions) {
    const d = Math.hypot(j.pos[0] - pos[0], j.pos[1] - pos[1]);
    if (d <= maxM && (!best || d < best.distM)) best = { id: j.id, distM: d };
  }
  return best;
}

/** True when DfT says the collision was not at (or within 20 m of) a junction. */
export const notAtJunction = (c: Pick<CollisionRow, 'junctionDetail'>) => c.junctionDetail.startsWith('Not at junction');

const TYPE_LABEL: Record<string, string> = {
  roundabout: 'Roundabout',
  signals: 'Traffic lights',
  giveway: 'Give way junction',
  stop: 'Stop junction',
  crossing: 'Crossing',
  plain: 'Junction',
};

/** "High Street / Cambridge Park", from the named roads meeting at each junction. */
export function junctionNames(world: Pick<WorldData, 'junctions' | 'roads' | 'graph'>): Map<string, string> {
  const roadName = new Map<number, string>();
  for (const r of world.roads) if (r.name) roadName.set(r.wayId, r.name);
  const names = new Map<string, Set<string>>();
  for (const e of world.graph.edges) {
    const n = roadName.get(e.wayId);
    if (!n) continue;
    for (const node of [e.from, e.to]) {
      if (!names.has(node)) names.set(node, new Set());
      names.get(node)!.add(n);
    }
  }
  const out = new Map<string, string>();
  for (const j of world.junctions) {
    const roads = [...(names.get(j.id) ?? [])].sort();
    out.set(j.id, roads.length ? roads.slice(0, 3).join(' / ') : TYPE_LABEL[j.type] ?? 'Junction');
  }
  return out;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/** Junctions the route drives through or right past. */
export function routeJunctionIds(route: Pick<Route, 'line' | 'steps'>, junctions: Pick<Junction, 'id' | 'pos'>[], maxM = ROUTE_PASS_M) {
  const ids = new Set(route.steps.map((s) => s.junctionId));
  for (const j of junctions) {
    for (let i = 1; i < route.line.length; i++) {
      if (distToSegment(j.pos, route.line[i - 1], route.line[i]) <= maxM) {
        ids.add(j.id);
        break;
      }
    }
  }
  return ids;
}

export function summariseCollisions(collisions: Pick<CollisionRow, 'severity'>[], since: Date | null) {
  return {
    total: collisions.length,
    serious: collisions.filter((c) => c.severity === 'serious').length,
    fatal: collisions.filter((c) => c.severity === 'fatal').length,
    since,
  };
}

export function buildJunctionDocs(
  world: WorldData,
  routes: Pick<Route, 'id' | 'line' | 'steps'>[],
  /** Collisions linked to a junction, by junction id. */
  collisionsByJunction: Map<string, Pick<CollisionRow, 'severity'>[]>,
  since: Date | null,
): JunctionDoc[] {
  const names = junctionNames(world);
  const passes = routes.map((r) => ({ id: r.id, ids: routeJunctionIds(r, world.junctions) }));
  return world.junctions.map((j) => ({
    _id: j.id,
    centreId: world.centre.id,
    type: j.type,
    name: names.get(j.id)!,
    location: { type: 'Point', coordinates: [j.lng, j.lat] },
    geometryConfidence: j.geometryConfidence,
    routeIds: passes.filter((p) => p.ids.has(j.id)).map((p) => p.id),
    collisions: summariseCollisions(collisionsByJunction.get(j.id) ?? [], since),
  }));
}
