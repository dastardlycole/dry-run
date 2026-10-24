import { signalSites } from '../../../client/src/world/lights';
import type { Edge, Route, StepControl, WorldData } from '../../../client/src/world/types';
import { rng } from '../seed/build';
import { buildRoute, controlFor, RoadIndex, turnDeg, type RouteDef } from './build';

// Test-style routes made from the road graph, for any centre (SPEC §16.4 step 3): loops that start and
// end at the centre and take in a roundabout, a set of lights and a give-way. No hand-picked junctions:
// try many mixes of those junctions, join them up with shortestPath, throw away the bad loops and keep a
// few that differ. Seeded, so the same map always gives the same routes.

export type Feature = 'roundabout' | 'signals' | 'giveway';

export interface AutoOptions {
  /** Graph node the routes start and end at. Default: the nearest ordinary road node to the map centre. */
  start?: string;
  /** Most routes to make. */
  count?: number;
  /** Fewer than this many full routes (all three features) and routes without a roundabout are added. */
  min?: number;
  lengthM?: readonly [number, number];
  /** Junctions further than this from the start (straight line) aren't used. */
  reachM?: number;
  /** Mixes to try per kind of route. */
  tries?: number;
  seed?: number;
  parkedCars?: number;
}

export interface AutoRoute {
  def: RouteDef;
  route: Route;
  /** Which kinds of junction the route takes in. */
  has: Feature[];
}

/** Two routes sharing more than this much of their length are too alike to offer both. */
export const MAX_OVERLAP = 0.5;
/** A heading change sharper than this (off a roundabout) is a U-turn, e.g. through a gap in a central reservation. */
export const UTURN_DEG = 145;
/** Two turns closer than this zig-zag round a tiny block: hard to follow and nothing like a test route. */
export const MIN_TURN_GAP_M = 25;
/** Turning this sharply from a road onto the same road (not at a roundabout) is turning round. */
export const SAME_ROAD_TURN_DEG = 100;
export const AUTO_LENGTH_M = [1800, 4500] as const;
const TARGET_M = 3000;

/**
 * What each kind of route must take in, best first. A later kind is only tried when the earlier ones
 * found too few, so an odd map (no lights, no roundabout, a cul-de-sac start) still gets something to
 * drive. "Loose" kinds drop the looks-only rules (finish on the start road, zig-zags, length).
 */
const TIERS: { need: Feature[]; loose?: boolean }[] = [
  { need: ['roundabout', 'signals', 'giveway'] },
  { need: ['signals', 'giveway'] },
  { need: ['roundabout', 'giveway'] },
  { need: ['giveway'] },
  { need: ['signals'] },
  { need: ['giveway'], loose: true },
  { need: ['signals'], loose: true },
  { need: ['roundabout'], loose: true },
];
/** Length limits for loose routes. */
const LOOSE_LENGTH_M = [500, 8000] as const;

/** Kinds of junction the steps of a route take in. */
export function featuresOf(route: Route): Feature[] {
  const seen = new Set<StepControl>(route.steps.map((s) => s.control));
  const has: Feature[] = [];
  if (seen.has('roundabout')) has.push('roundabout');
  if (seen.has('signals')) has.push('signals');
  if (seen.has('giveway') || seen.has('stop')) has.push('giveway');
  return has;
}

/** Whether a driver arriving on `a` may carry on along `b`: never straight back, never a U-turn. */
export function canFollow(a: Edge, b: Edge): boolean {
  if (b.to === a.from && b.wayId === a.wayId) return false;
  return a.roundabout || b.roundabout || Math.abs(turnDeg(a, b)) <= UTURN_DEG;
}

/**
 * Shortest path from `from` to `to` with no U-turns, carrying on from edge `after` (so it can't turn
 * straight back at a waypoint either) and, if given, arriving so it can carry on along `then`.
 * Never uses service roads. Null if there isn't one.
 */
export function legPath(
  idx: RoadIndex,
  after: Edge | undefined,
  from: string,
  to: string,
  then?: Edge,
): Edge[] | null {
  // Searches over edges, not nodes, because whether you may turn depends on the road you came in on.
  const dist = new Map<string, number>();
  const prev = new Map<string, Edge | undefined>();
  const heap = new MinHeap<Edge>();
  const relax = (e: Edge, d: number, from?: Edge) => {
    if (idx.isService(e) || d >= (dist.get(e.id) ?? Infinity)) return;
    dist.set(e.id, d);
    prev.set(e.id, from);
    heap.push(d, e);
  };
  for (const e of idx.out.get(from) ?? []) if (!after || canFollow(after, e)) relax(e, e.lengthM);
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [d, e] = item;
    if (d > dist.get(e.id)!) continue;
    if (e.to === to && (!then || canFollow(e, then))) {
      const path: Edge[] = [];
      for (let at: Edge | undefined = e; at; at = prev.get(at.id)) path.unshift(at);
      return path;
    }
    for (const f of idx.out.get(e.to) ?? []) if (canFollow(e, f)) relax(f, d + f.lengthM, e);
  }
  return null;
}

/** Zig-zags round a tiny block, or turns back across a dual carriageway: legal, but nothing like a test. */
function looksOdd(route: Route): boolean {
  const turns = route.steps.filter((s) => s.action === 'left' || s.action === 'right' || s.action === 'roundabout');
  if (turns.some((s, i) => i > 0 && s.atM - turns[i - 1].atM < MIN_TURN_GAP_M)) return true;
  return route.steps.some(
    (s) => s.action !== 'roundabout' && s.fromRoad === s.toRoad && Math.abs(s.turnDeg) > SAME_ROAD_TURN_DEG,
  );
}

/** Why a path isn't a good test route, or null if it's fine. */
export function pathProblem(idx: RoadIndex, edges: Edge[]): string | null {
  const used = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (used.has(e.id)) return `drives ${idx.name(e)} the same way twice`;
    used.add(e.id);
    if (idx.isService(e)) return `uses a service road`;
    const prev = edges[i - 1];
    if (!prev) continue;
    if (!canFollow(prev, e)) return `U-turn at ${idx.name(e)}`;
  }
  return null;
}

/** The nearest node to the map centre that ordinary (not service) roads run both in and out of. */
export function defaultStart(idx: RoadIndex): string {
  let best: string | undefined;
  let bestD = Infinity;
  for (const [id, p] of idx.nodePos) {
    const ok = (es: Edge[] | undefined) => (es ?? []).some((e) => !idx.isService(e) && !e.roundabout);
    if (!ok(idx.out.get(id)) || !ok(idx.into.get(id))) continue;
    const d = Math.hypot(p[0], p[1]);
    if (d < bestD) [best, bestD] = [id, d];
  }
  if (!best) throw new Error('no road to start from');
  return best;
}

export function autoRoutes(world: WorldData, opts: AutoOptions = {}): AutoRoute[] {
  const {
    count = 5,
    min = 3,
    lengthM = AUTO_LENGTH_M,
    reachM = world.centre.radiusM * 1.2,
    tries = 2000,
    seed = 1,
    parkedCars = 6,
  } = opts;
  const idx = new RoadIndex(world);
  const start = opts.start ?? defaultStart(idx);
  const startPos = idx.nodePos.get(start);
  if (!startPos) throw new Error(`start node ${start} isn't in the road graph`);
  const inReach = (node: string) => {
    const p = idx.nodePos.get(node)!;
    return Math.hypot(p[0] - startPos[0], p[1] - startPos[1]) <= reachM;
  };

  // Each junction to take in, as the waypoints that force the route through it the right way.
  const pools: Record<Feature, string[][]> = { roundabout: [], signals: [], giveway: [] };
  /** Give-way approaches by their two waypoints, so the leg before can arrive ready to take that exact road. */
  const approach = new Map<string, Edge>();
  const ordinary = (e: Edge) => !e.roundabout && !idx.isService(e);
  for (const a of world.graph.edges) {
    if (!ordinary(a) || !inReach(a.to)) continue;
    const ring = (idx.out.get(a.to) ?? []).find((e) => e.roundabout);
    if (ring) {
      // In from `a`, round the ring, out along an exit that leaves from a different ring node.
      for (const exit of ringExits(idx, a.to)) if (inReach(exit.to)) pools.roundabout.push([a.from, a.to, exit.to]);
    } else {
      const c = controlFor(idx, a, a.to);
      if (c === 'giveway' || c === 'stop') {
        pools.giveway.push([a.from, a.to]);
        approach.set(`${a.from}>${a.to}`, a);
      }
    }
  }
  for (const s of signalSites(world.junctions)) {
    const node = s.nodeIds.find((id) => idx.nodePos.has(id) && inReach(id));
    if (node) pools.signals.push([node]);
  }

  const legs = new Map<string, Edge[] | null>();
  const legFor = (after: Edge | undefined, from: string, to: string, then?: Edge) => {
    const key = `${after?.id}|${from}>${to}|${then?.id}`;
    if (!legs.has(key)) legs.set(key, legPath(idx, after, from, to, then));
    return legs.get(key)!;
  };

  const rand = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const found: Found[] = [];
  const seen = new Set<string>();
  let picked: Found[] = [];

  for (const [tier, { need, loose }] of TIERS.entries()) {
    if (picked.length >= min) break;
    const [minM, maxM] = loose ? LOOSE_LENGTH_M : lengthM;
    if (need.some((f) => !pools[f].length)) continue;
    for (let t = 0; t < tries; t++) {
      const parts = shuffle(need.map((f) => pick(pools[f])), rand);
      const waypoints = [start, ...parts.flat(), start].filter((w, i, ws) => i === 0 || w !== ws[i - 1]);
      const key = `${tier}:${waypoints.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const edges: Edge[] = [];
      let ok = true;
      for (let i = 0; ok && i < waypoints.length - 1; i++) {
        // When the next two waypoints are the ends of one road (a give-way approach), arrive ready to take it.
        const then = approach.get(`${waypoints[i + 1]}>${waypoints[i + 2]}`);
        const p = legFor(edges[edges.length - 1], waypoints[i], waypoints[i + 1], then);
        if (p) edges.push(...p);
        else ok = false;
      }
      if (!ok || pathProblem(idx, edges)) continue;
      // Finish back on the road it set off along (outside the centre), not round the corner.
      if (!loose && roadKey(idx, edges[edges.length - 1]) !== roadKey(idx, edges[0])) continue;
      const len = edges.reduce((s, e) => s + e.lengthM, 0);
      if (len < minM || len > maxM) continue;

      let route: Route;
      try {
        route = buildRoute(world, { id: 'check', name: '', waypoints, path: edges.map((e) => e.id), parkedCars: 0 }, idx);
      } catch {
        continue;
      }
      if (!loose && looksOdd(route)) continue;
      const has = featuresOf(route);
      if (!need.every((n) => has.includes(n))) continue;
      found.push({ waypoints, route, has, tier });
    }
    picked = pickDistinct(idx, found, count);
  }

  // Routes missing a kind of junction only fill in when there aren't enough full ones.
  const full = picked.filter((f) => f.has.length === TIERS[0].need.length);
  if (full.length >= min) picked = full;
  const names: string[] = [];
  return picked.map((f, i) => {
    const def: RouteDef = {
      id: `auto-${i + 1}`,
      name: routeName(i + 1, idx, f.route, names),
      waypoints: f.waypoints,
      path: f.route.edges,
      parkedCars,
    };
    return { def, route: buildRoute(world, def, idx), has: f.has };
  });
}

interface Found {
  waypoints: string[];
  route: Route;
  has: Feature[];
  /** Index in TIERS of the search that found it: lower = stricter, better. */
  tier: number;
}

/** Best first (most kinds of junction, strictest search, then nearest a typical test length), skipping near-copies. */
function pickDistinct(idx: RoadIndex, found: Found[], count: number): Found[] {
  const sorted = [...found].sort(
    (a, b) =>
      b.has.length - a.has.length ||
      a.tier - b.tier ||
      Math.abs(a.route.lengthM - TARGET_M) - Math.abs(b.route.lengthM - TARGET_M),
  );
  const picked: Found[] = [];
  for (const f of sorted) {
    if (picked.length >= count) break;
    if (!picked.some((p) => overlap(idx, p.route, f.route) > MAX_OVERLAP)) picked.push(f);
  }
  return picked;
}

/** Roads off the ring from any ring node other than `entry`. */
function ringExits(idx: RoadIndex, entry: string): Edge[] {
  const exits: Edge[] = [];
  let node = entry;
  for (let guard = 0; guard < 100; guard++) {
    const next = (idx.out.get(node) ?? []).find((e) => e.roundabout);
    if (!next || next.to === entry) break;
    node = next.to;
    exits.push(...(idx.out.get(node) ?? []).filter((e) => !e.roundabout && !idx.isService(e)));
  }
  return exits;
}

/** Share of the shorter route's length that is on roads the other one also drives (either way). */
function overlap(idx: RoadIndex, a: Route, b: Route): number {
  const len = (r: Route) => r.edges.map((id) => idx.edges.get(id)!);
  const key = (e: Edge) => [e.from, e.to].sort().join('|');
  const inA = new Set(len(a).map(key));
  const shared = len(b).filter((e) => inA.has(key(e))).reduce((s, e) => s + e.lengthM, 0);
  return shared / Math.min(a.lengthM, b.lengthM);
}

/** A road's name, or its way id when it has none. */
const roadKey = (idx: RoadIndex, e: Edge) => idx.road(e).name ?? `way ${e.wayId}`;

/**
 * "Route 1: Green Man Roundabout and Cambridge Park": the roundabout, and the named road it drives furthest
 * along (not counting the one it starts and ends on) that no earlier route is already named after.
 */
function routeName(n: number, idx: RoadIndex, route: Route, taken: string[]): string {
  const edges = route.edges.map((id) => idx.edges.get(id)!);
  const home = idx.road(edges[0]).name;
  const ring = edges.find((e) => e.roundabout);
  const ringRoad = ring && idx.road(ring).name;
  const roundabout = ringRoad && (/roundabout/i.test(ringRoad) ? ringRoad : `${ringRoad} roundabout`);
  const byRoad = new Map<string, number>();
  for (const e of edges) {
    const name = idx.road(e).name;
    if (name && name !== home && !e.roundabout) byRoad.set(name, (byRoad.get(name) ?? 0) + e.lengthM);
  }
  const roads = [...byRoad].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const label = [...roads.map((r) => (roundabout ? `${roundabout} and ${r}` : r)), roundabout ?? ''].find(
    (l) => l && !taken.includes(l),
  );
  if (label) taken.push(label);
  return label ? `Route ${n}: ${label}` : `Route ${n}`;
}

class MinHeap<T> {
  private items: [number, T][] = [];
  push(key: number, value: T) {
    const a = this.items;
    a.push([key, value]);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, T] | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}
