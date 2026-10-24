import { headingOf, nearestOnPolyline, polylineLength, wrapAngle } from './geometry';
import { buildRoute, distancesFrom, isReverse, pathTo, type RoadIndex } from './route-build';
import type { Edge, Route, Vec2 } from './types';

// A new way back after a missed turn or a wrong exit (row 16): from the road the car is on, the shortest legal
// way to the original route, then the rest of the route as it was. It's built like any other route, so the
// arrows, directions, stop lines and fault rules all just follow it. Pure.

/** The car must be this close to a road's centre line for it to count as on that road. */
export const ON_ROAD_M = 12;
/** The way back may rejoin this far behind where the car left the route (back at the junction it missed). */
const REJOIN_BEHIND_M = 20;

/**
 * The road the car is on, in the direction it's going: the nearest edge within ON_ROAD_M whose direction
 * there is within 90° of `heading` (rotation about +Y, 0 = east). Null when there isn't one.
 */
export function edgeUnder(edges: Edge[], pos: Vec2, heading: number): Edge | null {
  let best: { e: Edge; d: number } | null = null;
  for (const e of edges) {
    const { d, k } = nearestOnPolyline(e.points, pos);
    if (d > ON_ROAD_M || (best && d >= best.d)) continue;
    const [a, b] = [e.points[k], e.points[k + 1] ?? e.points[k]];
    if (Math.abs(wrapAngle(headingOf(b[0] - a[0], b[1] - a[1]) - heading)) >= Math.PI / 2) continue;
    best = { e, d };
  }
  return best?.e ?? null;
}

/**
 * The route from the car back onto `route`, or null when there's no way back (off the roads, a dead end).
 * `lastOnM`: how far along `route` the car was when it left it. Of the junctions on the route from there on
 * (and its end), it rejoins at the one with the least detour plus route skipped, so it comes back early
 * rather than cutting the drive short. Never a U-turn where it sets off or where it rejoins, unless there's
 * no other way. `n` numbers the reroute, so its step ids (r1-s1, …) don't clash with the route's.
 */
export function reroute(idx: RoadIndex, route: Route, pos: Vec2, heading: number, lastOnM: number, n: number): Route | null {
  const carEdge = edgeUnder(idx.world.graph.edges, pos, heading);
  if (!carEdge) return null;
  const edges = route.edges.map((id) => idx.edges.get(id)).filter((e): e is Edge => !!e);
  if (!edges.length) return null;
  // Where each edge starts along the route's driving line (`lastOnM` is measured on it). The line is the
  // centre line shifted into the left lane, so it's a little shorter or longer: scaled to match.
  const startM: number[] = [];
  let centreM = 0;
  for (const e of edges) {
    startM.push(centreM);
    centreM += polylineLength(e.points);
  }
  const total = route.lengthM;
  for (let k = 0; k < startM.length; k++) startM[k] *= total / centreM;

  const from = carEdge.to;
  // Turning straight round only when there's no other way (a road off the edge of the map, a dead end).
  for (const turnRound of [false, true]) {
    const { dist, prev } = distancesFrom(idx, from, undefined, (e) => !turnRound && isReverse(e, carEdge));
    /** The edge the way back arrives at `node` by. */
    const arriving = (node: string) => (node === from ? carEdge : prev.get(node)!);
    let best: { k: number; cost: number } | null = null;
    for (let k = 0; k <= edges.length; k++) {
      const atM = k < edges.length ? startM[k] : total;
      if (atM < lastOnM - REJOIN_BEHIND_M) continue;
      const node = rejoinNode(edges, k);
      const d = dist.get(node);
      if (d === undefined) continue;
      if (k < edges.length && !turnRound && isReverse(edges[k], arriving(node))) continue;
      const cost = d + Math.max(0, atM - lastOnM);
      if (!best || cost < best.cost) best = { k, cost };
    }
    if (best) return build(idx, route, carEdge, pathTo(prev, from, rejoinNode(edges, best.k)), edges.slice(best.k), n);
  }
  return null;
}

const rejoinNode = (edges: Edge[], k: number) => (k < edges.length ? edges[k].from : edges[edges.length - 1].to);

/** The way back as a route: the car's road, the detour, then the rest of the original route. */
function build(idx: RoadIndex, route: Route, carEdge: Edge, detour: Edge[], rest: Edge[], n: number): Route | null {
  const path = [carEdge, ...detour, ...rest];
  try {
    const back = buildRoute(
      idx.world,
      { id: route.id, name: route.name, waypoints: [path[0].from, path[path.length - 1].to], path: path.map((e) => e.id), parkedCars: 0 },
      idx,
    );
    return { ...back, steps: back.steps.map((s) => ({ ...s, id: `r${n}-${s.id}` })) };
  } catch {
    return null;
  }
}
