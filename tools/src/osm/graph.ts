import type { Confidence, Control, Edge, GraphNode, Junction, JunctionType, Vec2 } from '../../../client/src/world/types';

// Builds the road graph (SPEC §4.1 FR-W6, FR-W7): graph nodes where roads meet or end,
// one directed edge per direction of travel, and junctions typed from nearby traffic controls.

export interface WayIn {
  id: number;
  nodeIds: number[];
  /** Already flipped so that one-way roads run forward. */
  oneway: boolean;
  roundabout: boolean;
  maxspeedMph: number;
  confidence: Confidence;
}

export type ControlTag = 'signals' | 'giveway' | 'stop' | 'crossing' | 'mini_roundabout';

/** A control node off the junction itself (e.g. signals on the approach) links to a junction this close. */
export const CONTROL_LINK_M = 30;

// When several controls reach a junction, the strongest wins.
const PRIORITY: Record<JunctionType, number> = { plain: 0, crossing: 1, giveway: 2, stop: 3, signals: 4, roundabout: 5 };

export const nodeId = (osmId: number) => `osm-node-${osmId}`;

export function dist([ax, az]: Vec2, [bx, bz]: Vec2): number {
  return Math.hypot(ax - bx, az - bz);
}

export function polylineLength(points: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

/** Splits a node list into runs of consecutive nodes that pass `keep` (used to clip ways to the map). */
export function clipRuns(nodeIds: number[], keep: (id: number) => boolean): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  for (const id of nodeIds) {
    if (keep(id)) run.push(id);
    else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

export function buildGraph(ways: WayIn[], pos: Map<number, Vec2>, controlTags: Map<number, ControlTag>) {
  // 1. Graph nodes: way ends, nodes shared by more than one way (or visited twice), and control nodes.
  const uses = new Map<number, number>();
  for (const w of ways) for (const id of w.nodeIds) uses.set(id, (uses.get(id) ?? 0) + 1);
  const isGraphNode = (id: number) => (uses.get(id) ?? 0) >= 2 || controlTags.has(id);
  const graphNodes = new Set<number>();
  for (const w of ways) {
    graphNodes.add(w.nodeIds[0]);
    graphNodes.add(w.nodeIds[w.nodeIds.length - 1]);
    for (const id of w.nodeIds) if (isGraphNode(id)) graphNodes.add(id);
  }

  // 2. Cut each way at graph nodes into edges.
  const edges: Edge[] = [];
  const neighbours = new Map<number, Set<number>>();
  const lowConfidence = new Set<number>();
  const onRoundabout = new Set<number>();
  const link = (a: number, b: number) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  // A way cut into several runs by the map edge shares one counter, so edge ids stay unique.
  const nextPiece = new Map<number, number>();
  for (const w of ways) {
    let start = 0;
    let piece = nextPiece.get(w.id) ?? 0;
    for (let i = 1; i < w.nodeIds.length; i++) {
      const id = w.nodeIds[i];
      if (!graphNodes.has(id)) continue;
      const ids = w.nodeIds.slice(start, i + 1);
      const points = ids.map((n) => pos.get(n)!);
      const a = ids[0];
      const b = id;
      const base = { wayId: w.id, lengthM: polylineLength(points), maxspeedMph: w.maxspeedMph, ...(w.roundabout && { roundabout: true }) };
      edges.push({ id: `${w.id}:${piece}:f`, from: nodeId(a), to: nodeId(b), points, ...base });
      if (!w.oneway) edges.push({ id: `${w.id}:${piece}:b`, from: nodeId(b), to: nodeId(a), points: [...points].reverse(), ...base });
      link(a, b);
      link(b, a);
      for (const n of [a, b]) {
        if (w.confidence === 'low') lowConfidence.add(n);
        if (w.roundabout) onRoundabout.add(n);
      }
      start = i;
      piece++;
    }
    nextPiece.set(w.id, piece);
  }

  // 3. Junctions: where 3+ roads meet, plus controls.
  const degree = (id: number) => neighbours.get(id)?.size ?? 0;
  const junctions = new Map<number, Junction>();
  const upgrade = (j: Junction, type: JunctionType) => {
    if (PRIORITY[type] > PRIORITY[j.type]) j.type = type;
  };
  const makeJunction = (id: number, type: JunctionType): Junction => {
    let j = junctions.get(id);
    if (!j) {
      j = {
        id: nodeId(id),
        type: 'plain',
        pos: pos.get(id)!,
        lat: 0,
        lng: 0,
        degree: degree(id),
        geometryConfidence: lowConfidence.has(id) ? 'low' : 'high',
      };
      junctions.set(id, j);
    }
    upgrade(j, type);
    return j;
  };
  for (const id of graphNodes) {
    if (degree(id) >= 3) makeJunction(id, onRoundabout.has(id) ? 'roundabout' : 'plain');
  }
  // 4. Controls: on a junction, or linked to the nearest one; otherwise they stand alone (e.g. a pelican crossing).
  // Standalone ones count as junctions for later controls, so a crossing mapped as two signal nodes stays one junction.
  const controls: Control[] = [];
  for (const [id, tag] of controlTags) {
    const p = pos.get(id);
    if (!p || !graphNodes.has(id)) continue; // not on a road we kept
    if (tag === 'mini_roundabout') {
      makeJunction(id, 'roundabout');
      continue;
    }
    const control: Control = { osmId: id, type: tag, pos: p };
    let target = junctions.get(id);
    if (!target) {
      let best = CONTROL_LINK_M;
      for (const j of junctions.values()) {
        const d = dist(j.pos, p);
        if (d < best) {
          best = d;
          target = j;
        }
      }
    }
    if (target) {
      // A zebra next to a junction doesn't make the junction a crossing.
      if (tag !== 'crossing') upgrade(target, tag);
    } else {
      target = makeJunction(id, tag);
    }
    control.junctionId = target.id;
    controls.push(control);
  }

  const nodes: GraphNode[] = [...graphNodes].map((id) => ({ id: nodeId(id), pos: pos.get(id)! }));
  return { nodes, edges, junctions: [...junctions.values()], controls };
}
