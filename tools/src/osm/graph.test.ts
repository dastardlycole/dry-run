import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../client/src/world/types';
import { buildGraph, clipRuns, polylineLength, type ControlTag, type WayIn } from './graph';

// A T-junction: a main road 1–2–3 running east, a side road 2–4 going south, with a give-way
// sign (node 5) on the side road 10 m before the junction.
//
//   1 ---- 2 ---- 3
//          |
//          5
//          |
//          4
const pos = new Map<number, Vec2>([
  [1, [-50, 0]],
  [2, [0, 0]],
  [3, [50, 0]],
  [5, [0, 10]],
  [4, [0, 50]],
]);
const way = (id: number, nodeIds: number[], over: Partial<WayIn> = {}): WayIn => ({
  id,
  nodeIds,
  oneway: false,
  roundabout: false,
  maxspeedMph: 30,
  confidence: 'high',
  ...over,
});

describe('clipRuns', () => {
  it('keeps runs of 2+ nodes inside the map', () => {
    expect(clipRuns([1, 2, 3, 4, 5, 6, 7], (id) => id !== 3 && id !== 5)).toEqual([[1, 2], [6, 7]]);
    expect(clipRuns([1, 2, 3, 4], () => true)).toEqual([[1, 2, 3, 4]]);
  });
});

describe('polylineLength', () => {
  it('adds up segment lengths', () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
  });
});

describe('buildGraph', () => {
  const ways = [way(100, [1, 2, 3]), way(200, [2, 5, 4], { confidence: 'low' })];
  const controls = new Map<number, ControlTag>([[5, 'giveway']]);
  const g = buildGraph(ways, pos, controls);

  it('makes graph nodes at ends, shared nodes and controls', () => {
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['osm-node-1', 'osm-node-2', 'osm-node-3', 'osm-node-4', 'osm-node-5']);
  });

  it('makes one edge per direction on two-way roads', () => {
    // main road: 1-2, 2-3; side road: 2-5, 5-4; each both ways
    expect(g.edges).toHaveLength(8);
    const e = g.edges.find((x) => x.from === 'osm-node-1' && x.to === 'osm-node-2')!;
    expect(e.lengthM).toBe(50);
    expect(e.wayId).toBe(100);
    const back = g.edges.find((x) => x.from === 'osm-node-2' && x.to === 'osm-node-1')!;
    expect(back.points).toEqual([[0, 0], [-50, 0]]);
  });

  it('makes only forward edges on one-way roads', () => {
    const one = buildGraph([way(1, [1, 2, 3], { oneway: true }), way(2, [2, 5, 4])], pos, new Map());
    expect(one.edges.filter((e) => e.wayId === 1).map((e) => `${e.from}>${e.to}`)).toEqual(['osm-node-1>osm-node-2', 'osm-node-2>osm-node-3']);
  });

  it('types the junction from a nearby give-way sign and keeps its OSM id (FR-W7)', () => {
    expect(g.junctions).toHaveLength(1);
    const j = g.junctions[0];
    expect(j).toMatchObject({ id: 'osm-node-2', type: 'giveway', degree: 3 });
    expect(g.controls).toEqual([{ osmId: 5, type: 'giveway', pos: [0, 10], junctionId: 'osm-node-2' }]);
  });

  it('flags junctions touching roads with guessed width (FR-W10)', () => {
    expect(g.junctions[0].geometryConfidence).toBe('low');
    const sure = buildGraph([way(100, [1, 2, 3]), way(200, [2, 5, 4])], pos, controls);
    expect(sure.junctions[0].geometryConfidence).toBe('high');
  });

  it('does not let a zebra crossing near a junction change its type', () => {
    const z = buildGraph(ways, pos, new Map<number, ControlTag>([[5, 'crossing']]));
    expect(z.junctions.map((j) => j.type)).toEqual(['plain']);
    expect(z.controls[0].junctionId).toBe('osm-node-2');
  });

  it('turns a control far from any junction into its own junction', () => {
    const far = new Map(pos).set(5, [0, 40] as Vec2);
    const s = buildGraph(ways, far, new Map<number, ControlTag>([[5, 'signals']]));
    expect(s.junctions.find((j) => j.id === 'osm-node-5')?.type).toBe('signals');
  });

  it('merges two signal nodes at one crossing into a single junction', () => {
    const p = new Map(pos).set(5, [0, 40] as Vec2).set(6, [0, 46] as Vec2);
    const s = buildGraph([way(100, [1, 2, 3]), way(200, [2, 5, 6, 4])], p, new Map<number, ControlTag>([[5, 'signals'], [6, 'signals']]));
    expect(s.junctions.filter((j) => j.type === 'signals').map((j) => j.id)).toEqual(['osm-node-5']);
    expect(s.controls.map((c) => c.junctionId)).toEqual(['osm-node-5', 'osm-node-5']);
  });

  it('keeps edge ids unique when the map edge cuts a way into several runs', () => {
    const p = new Map(pos).set(6, [100, 0] as Vec2).set(7, [150, 0] as Vec2);
    const s = buildGraph([way(100, [1, 2]), way(100, [6, 7])], p, new Map());
    const ids = s.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('types junctions on a roundabout ring', () => {
    const r = buildGraph([way(100, [1, 2, 3], { roundabout: true, oneway: true }), way(200, [2, 5, 4])], pos, new Map());
    expect(r.junctions[0]).toMatchObject({ id: 'osm-node-2', type: 'roundabout' });
    expect(r.edges.filter((e) => e.roundabout).map((e) => e.wayId)).toEqual([100, 100]);
    expect(r.edges.some((e) => e.wayId === 200 && e.roundabout)).toBe(false);
  });
});
