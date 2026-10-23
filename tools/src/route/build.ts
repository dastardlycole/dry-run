import {
  halfWidthsAt,
  headingOf,
  nearestOnPolyline,
  offsetPolyline,
  pointAlong,
  polylineLength,
  posKey,
  rightOf,
  wrapAngle,
} from '../../../client/src/world/geometry';
import { arrivalHeading, signalSites, stopLineBackM } from '../../../client/src/world/lights';
import type {
  Edge,
  Pose,
  Road,
  Route,
  RouteStep,
  StepAction,
  StepControl,
  StopLine,
  Vec2,
  WorldData,
} from '../../../client/src/world/types';

// Builds a fixed test route through the road graph (SPEC §4.4 FR-R1): the path, the line a car in the
// left lane follows, the steps the examiner will speak (turns, roundabout exits) and where to paint
// stop/give-way lines. Pure, so it can be unit tested on a tiny made-up map.

export interface RouteDef {
  id: string;
  name: string;
  /** Graph node ids to pass through in order; between them the shortest legal path is used. */
  waypoints: string[];
  /** How many cars to park on side streets just off the route. */
  parkedCars: number;
}

/** Heading changes bigger than this are a left or right turn. */
export const TURN_DEG = 30;
/** Parked cars keep at least this far from any junction. */
export const PARK_CLEAR_M = 25;
/** Parked cars sit on side streets this far (min, max) from the route, so you see them but never meet them. */
export const PARK_NEAR_ROUTE_M = [10, 60] as const;
/** Space between a parked car's side and the kerb line. */
const PARK_KERB_GAP_M = 0.2;
const PARKED_HALF_WIDTH_M = 0.9;
/** Where the car sits at the start/end of the route, from the end node. */
const START_IN_M = 5;

const RANK: Record<string, number> = {
  motorway: 6,
  trunk: 5,
  primary: 4,
  secondary: 3,
  tertiary: 2,
  unclassified: 1,
  residential: 1,
  living_street: 0,
  service: 0,
};
/** How important a road is, for working out who gives way. */
export const roadRank = (highway: string) => RANK[highway.replace(/_link$/, '')] ?? 1;

const deg = (rad: number) => (rad * 180) / Math.PI;

/** Centre of the left-hand lane, as an offset from the road's centre line (negative = left). */
export function leftLaneOffset(r: Pick<Road, 'widthM' | 'lanes' | 'oneway'>): number {
  // A two-way road always has at least one lane each way, even when OSM says lanes=1.
  const lanes = r.oneway ? r.lanes : Math.max(r.lanes, 2);
  return -r.widthM / 2 + r.widthM / lanes / 2;
}

/** Lookups over the world used while building a route. */
export class RoadIndex {
  readonly edges = new Map<string, Edge>();
  readonly out = new Map<string, Edge[]>();
  readonly into = new Map<string, Edge[]>();
  readonly roads = new Map<number, Road>();
  readonly nodePos = new Map<string, Vec2>();
  readonly halfAt: Map<string, number>;
  /** Node id → signal site id. */
  readonly siteOf = new Map<string, string>();

  constructor(readonly world: WorldData) {
    for (const r of world.roads) if (!this.roads.has(r.wayId)) this.roads.set(r.wayId, r);
    for (const n of world.graph.nodes) this.nodePos.set(n.id, n.pos);
    for (const e of world.graph.edges) {
      this.edges.set(e.id, e);
      push(this.out, e.from, e);
      push(this.into, e.to, e);
    }
    this.halfAt = halfWidthsAt(world.roads);
    for (const s of signalSites(world.junctions)) for (const id of s.nodeIds) this.siteOf.set(id, s.id);
  }

  road(e: Edge): Road {
    const r = this.roads.get(e.wayId);
    if (!r) throw new Error(`no road for way ${e.wayId}`);
    return r;
  }

  isService = (e: Edge) => this.road(e).highway === 'service';

  name(e: Edge): string {
    const r = this.road(e);
    return r.name ?? (e.roundabout ? 'the roundabout' : 'the road');
  }

  /** Half the widest road at a graph node: the radius of the junction patch. */
  halfWidth(nodeId: string): number {
    return this.halfAt.get(posKey(this.nodePos.get(nodeId)!)) ?? 3;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** Shortest path from node `from` to node `to`, never using service roads. */
export function shortestPath(idx: RoadIndex, from: string, to: string): Edge[] {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, Edge>();
  const done = new Set<string>();
  const queue: [number, string][] = [[0, from]];
  while (queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[best][0]) best = i;
    const [d, u] = queue.splice(best, 1)[0];
    if (done.has(u)) continue;
    done.add(u);
    if (u === to) break;
    for (const e of idx.out.get(u) ?? []) {
      if (idx.isService(e)) continue;
      const nd = d + e.lengthM;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, e);
        queue.push([nd, e.to]);
      }
    }
  }
  const path: Edge[] = [];
  for (let at = to; at !== from; ) {
    const e = prev.get(at);
    if (!e) throw new Error(`no legal path from ${from} to ${to}`);
    path.unshift(e);
    at = e.from;
  }
  return path;
}

/** Heading of travel at the start of an edge (over its first few metres). */
export function departureHeading(e: Edge, sampleM = 12): number {
  const pts = e.points;
  let i = 1;
  while (i < pts.length - 1 && Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) < sampleM) i++;
  return headingOf(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
}

/** Signed change of heading from arriving on `a` to leaving on `b`, in degrees (positive = left). */
export const turnDeg = (a: Edge, b: Edge) => deg(wrapAngle(departureHeading(b) - arrivalHeading(a)));

export const actionFor = (turn: number): StepAction => (Math.abs(turn) < TURN_DEG ? 'ahead' : turn > 0 ? 'left' : 'right');

/** The same road straight back the way you came. */
const isReverse = (e: Edge, a: Edge) => e.to === a.from && e.wayId === a.wayId;

/** Roads you could leave a roundabout by at this ring node (service roads don't count as exits). */
const exitsAt = (idx: RoadIndex, node: string) =>
  (idx.out.get(node) ?? []).filter((e) => !e.roundabout && !idx.isService(e));

/**
 * Who has to stop or give way arriving on `a` at `node`: lights; an OSM give-way/stop sign on this
 * approach; or, unmarked, a minor road meeting a bigger one, or a road ending at a T-junction.
 */
export function controlFor(idx: RoadIndex, a: Edge, node: string): StepControl {
  if (idx.siteOf.has(node)) return 'signals';
  for (const c of idx.world.controls) {
    if ((c.type !== 'giveway' && c.type !== 'stop') || c.junctionId !== node) continue;
    // The sign must be on this approach, not on another arm of the junction.
    if (nearestOnPolyline(a.points, c.pos).d < 2) return c.type;
  }
  const others = [...(idx.out.get(node) ?? []), ...(idx.into.get(node) ?? [])].filter(
    (e) => e.wayId !== a.wayId && !idx.isService(e),
  );
  // Only a real junction: where two roads just join end to end there is no one to give way to.
  const arms = new Set([a.from, ...others.map((e) => (e.from === node ? e.to : e.from))]);
  if (arms.size < 3) return 'none';
  const mine = roadRank(idx.road(a).highway);
  if (others.some((e) => roadRank(idx.road(e).highway) > mine)) return 'giveway';
  // A road that ends here (nothing carries on under its name) meets the other road at a T.
  const name = idx.road(a).name;
  const carriesOn = (idx.out.get(node) ?? []).some(
    (e) => !isReverse(e, a) && (e.wayId === a.wayId || (name !== undefined && idx.road(e).name === name)),
  );
  return carriesOn ? 'none' : 'giveway';
}

/** Distances along each route edge's centre line, so points can be found by route distance. */
class Centreline {
  readonly startM: number[] = [];
  readonly lengthM: number;
  constructor(readonly edges: Edge[]) {
    let m = 0;
    for (const e of edges) {
      this.startM.push(m);
      m += polylineLength(e.points);
    }
    this.lengthM = m;
  }
  /** The edge `m` metres along the route, and the point and direction there. */
  at(m: number): { i: number; edge: Edge; p: Vec2; dir: Vec2 } {
    let i = this.edges.length - 1;
    while (i > 0 && this.startM[i] > m) i--;
    const edge = this.edges[i];
    return { i, edge, ...pointAlong(edge.points, m - this.startM[i]) };
  }
}

export function buildRoute(world: WorldData, def: RouteDef): Route {
  const idx = new RoadIndex(world);
  if (def.waypoints.length < 2) throw new Error('a route needs at least two waypoints');
  const edges: Edge[] = [];
  for (let i = 0; i < def.waypoints.length - 1; i++) {
    const [from, to] = [def.waypoints[i], def.waypoints[i + 1]];
    if (from === to) throw new Error(`waypoint ${from} is repeated back to back`);
    edges.push(...shortestPath(idx, from, to));
  }

  // The driving line: the whole path shifted into the left lane in one go, so corners join cleanly.
  // Where two edges meet, the point takes the incoming edge's lane offset.
  const path: Vec2[] = [];
  const offsets: number[] = [];
  const endIdx: number[] = []; // index in `path` of the end of each edge
  for (const e of edges) {
    const off = leftLaneOffset(idx.road(e));
    e.points.forEach((p, k) => {
      const last = path[path.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.01) {
        if (k > 0) offsets[offsets.length - 1] = off;
        return;
      }
      path.push(p);
      offsets.push(off);
    });
    endIdx.push(path.length - 1);
  }
  const line = offsetPolyline(path, offsets);
  const lineM: number[] = [0];
  for (let k = 1; k < line.length; k++) lineM.push(lineM[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
  const endM = endIdx.map((k) => lineM[k]); // driving-line distance at the end of each edge
  const centre = new Centreline(edges);
  /** Driving-line distance of the point on edge `i`'s stretch of the line nearest to `p`. */
  const lineMNear = (i: number, p: Vec2) => {
    const { k, t } = nearestOnPolyline(line, p, (i === 0 ? 0 : endIdx[i - 1]) - 1, endIdx[i] + 1);
    return lineM[k] + t * (lineM[k + 1] - lineM[k]);
  };

  /** Stop/give-way line across the route's side of the road, just before the junction patch at the end of edge `i`. */
  const stopLine = (i: number, kind: StopLine['kind']): StopLine => {
    const nodeM = centre.startM[i] + polylineLength(edges[i].points);
    const backM = Math.min(stopLineBackM(idx.halfWidth(edges[i].to)), nodeM);
    const { i: ei, edge, p, dir } = centre.at(nodeM - backM);
    const road = idx.road(edge);
    const half = road.widthM / 2;
    const r = rightOf(dir);
    const across = (o: number): Vec2 => [round(p[0] + r[0] * o), round(p[1] + r[1] * o)];
    return { kind, atM: round(lineMNear(ei, p)), a: across(-half), b: across(road.oneway ? half : 0) };
  };

  const steps: RouteStep[] = [];
  const addStep = (s: Omit<RouteStep, 'id'>) => steps.push({ id: `s${steps.length + 1}`, ...s });

  for (let i = 0; i < edges.length - 1; ) {
    const a = edges[i];
    const node = a.to;
    const pos = idx.nodePos.get(node)!;
    const atM = round(endM[i]);

    // Roundabout: ride the ring to the exit and count the exits passed on the way.
    if (edges[i + 1].roundabout && !a.roundabout) {
      let k = i + 1;
      while (k < edges.length && edges[k].roundabout) k++;
      if (k >= edges.length) throw new Error('route ends on a roundabout');
      const exitEdge = edges[k];
      let exit = 0;
      for (let r = i + 1; r < k; r++) {
        const here = exitsAt(idx, edges[r].to);
        if (edges[r].to === exitEdge.from) {
          exit += here.findIndex((e) => e.id === exitEdge.id) + 1;
          break;
        }
        exit += here.length;
      }
      addStep({
        junctionId: node,
        pos,
        atM,
        action: 'roundabout',
        exit,
        exits: countExits(idx, node),
        turnDeg: round(turnDeg(a, exitEdge)),
        control: 'roundabout',
        approachEdgeId: a.id,
        exitEdgeId: exitEdge.id,
        fromRoad: idx.name(a),
        toRoad: idx.name(exitEdge),
        line: stopLine(i, 'giveway'),
      });
      i = k;
      continue;
    }

    // A set of lights can span several graph nodes: treat it as one junction from entry to exit.
    let j = i;
    const site = idx.siteOf.get(node);
    if (site) while (j + 1 < edges.length - 1 && idx.siteOf.get(edges[j + 1].to) === site) j++;
    const b = edges[j + 1];

    const turn = turnDeg(a, b);
    const action = actionFor(turn);
    const control = controlFor(idx, a, node);
    // The choices are at the node the route leaves from (the last one, for lights over several nodes).
    const options = (idx.out.get(b.from) ?? []).filter((e) => !idx.isService(e) && !isReverse(e, edges[j]));
    const straightest = options.reduce((s, e) => (Math.abs(turnDeg(a, e)) < Math.abs(turnDeg(a, s)) ? e : s), b);
    // Say something where there's a choice, unless it's just carrying straight on along the obvious road.
    const choice = options.length >= 2 && (action !== 'ahead' || straightest.id !== b.id);
    if (choice || control !== 'none') {
      addStep({
        junctionId: node,
        pos,
        atM,
        action,
        turnDeg: round(turn),
        control,
        approachEdgeId: a.id,
        exitEdgeId: b.id,
        fromRoad: idx.name(a),
        toRoad: idx.name(b),
        ...(control !== 'none' && { line: stopLine(i, control === 'signals' || control === 'stop' ? 'stop' : 'giveway') }),
      });
    }
    i = j + 1;
  }

  const lengthM = round(lineM[lineM.length - 1]);
  const last = edges[edges.length - 1];
  addStep({
    junctionId: last.to,
    pos: idx.nodePos.get(last.to)!,
    atM: lengthM,
    action: 'end',
    turnDeg: 0,
    control: 'none',
    approachEdgeId: last.id,
    exitEdgeId: last.id,
    fromRoad: idx.name(last),
    toRoad: idx.name(last),
  });

  return {
    id: def.id,
    name: def.name,
    centreId: world.centre.id,
    generatedAt: new Date().toISOString(),
    lengthM,
    start: poseAlong(line, START_IN_M),
    end: poseAlong(line, lengthM - START_IN_M),
    edges: edges.map((e) => e.id),
    line: line.map(roundPt),
    lineM: lineM.map((m) => round(m)),
    steps,
    parkedCars: parkedOffRoute(idx, edges, line, lineM, def.parkedCars),
  };
}

/** Exits all the way round the ring from `entry` (service roads don't count). */
function countExits(idx: RoadIndex, entry: string): number {
  let count = 0;
  let node = entry;
  for (let guard = 0; guard < 100; guard++) {
    const next = (idx.out.get(node) ?? []).find((e) => e.roundabout);
    if (!next) break;
    node = next.to;
    count += exitsAt(idx, node).length;
    if (node === entry) break;
  }
  return count;
}

function poseAlong(line: Vec2[], m: number): Pose {
  const { p, dir } = pointAlong(line, m);
  return { pos: roundPt(p), heading: round(headingOf(dir[0], dir[1]), 1e4) };
}

/** Road types where cars park at the kerb. */
const PARKING_ROADS = new Set(['residential', 'unclassified', 'tertiary', 'living_street']);

/**
 * Cars parked on side streets just off the route: visible as you drive past, never in your way.
 * Spread along the route, one per street, at the left kerb halfway along a stretch clear of junctions.
 */
function parkedOffRoute(idx: RoadIndex, edges: Edge[], line: Vec2[], lineM: number[], count: number): Pose[] {
  const routeWays = new Set(edges.map((e) => e.wayId));
  const candidates: { pose: Pose; m: number; wayId: number }[] = [];
  for (const e of idx.world.graph.edges) {
    const road = idx.road(e);
    if (!e.id.endsWith(':f') || road.oneway || routeWays.has(e.wayId) || !PARKING_ROADS.has(road.highway)) continue;
    const { p, dir } = pointAlong(e.points, polylineLength(e.points) / 2);
    if (idx.world.junctions.some((j) => Math.hypot(j.pos[0] - p[0], j.pos[1] - p[1]) < PARK_CLEAR_M)) continue;
    const near = nearestOnPolyline(line, p);
    if (near.d < PARK_NEAR_ROUTE_M[0] || near.d > PARK_NEAR_ROUTE_M[1]) continue;
    const o = -(road.widthM / 2 - PARKED_HALF_WIDTH_M - PARK_KERB_GAP_M);
    const r = rightOf(dir);
    candidates.push({
      pose: { pos: roundPt([p[0] + r[0] * o, p[1] + r[1] * o]), heading: round(headingOf(dir[0], dir[1]), 1e4) },
      m: lineM[near.k] + near.t * (lineM[near.k + 1] - lineM[near.k]),
      wayId: e.wayId,
    });
  }
  const length = lineM[lineM.length - 1];
  const picked: typeof candidates = [];
  for (let k = 0; k < count; k++) {
    const target = ((k + 0.5) * length) / count;
    const free = candidates.filter((c) => !picked.some((p) => p.wayId === c.wayId));
    if (!free.length) break;
    picked.push(free.reduce((best, c) => (Math.abs(c.m - target) < Math.abs(best.m - target) ? c : best)));
  }
  return picked.sort((a, b) => a.m - b.m).map((c) => c.pose);
}

const round = (v: number, k = 100) => Math.round(v * k) / k;
const roundPt = ([x, z]: Vec2): Vec2 => [round(x), round(z)];
