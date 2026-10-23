import { describe, expect, it } from 'vitest';
import type { Control, Edge, Junction, Road, Vec2, WorldData } from '../../../client/src/world/types';
import { actionFor, buildRoute, leftLaneOffset, PARK_CLEAR_M, RoadIndex, shortestPath, type RouteDef } from './build';

// Tiny made-up maps. x = east, z = south (so "north" is -z).
interface WaySpec {
  id: number;
  nodes: string[];
  highway?: string;
  name?: string;
  oneway?: boolean;
  roundabout?: boolean;
}

function makeWorld(pos: Record<string, Vec2>, ways: WaySpec[], controls: Control[] = []): WorldData {
  const roads: Road[] = [];
  const edges: Edge[] = [];
  const degree = new Map<string, Set<string>>();
  const link = (a: string, b: string) => degree.set(a, (degree.get(a) ?? new Set()).add(b));
  for (const w of ways) {
    const points = w.nodes.map((n) => pos[n]);
    roads.push({
      wayId: w.id,
      name: w.name,
      highway: w.highway ?? 'residential',
      lanes: w.oneway ? 1 : 2,
      widthM: w.oneway ? 3.2 : 6.4,
      maxspeedMph: 30,
      oneway: !!w.oneway,
      layer: 0,
      confidence: 'high',
      points,
    });
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const [a, b] = [w.nodes[i], w.nodes[i + 1]];
      const pts = [pos[a], pos[b]];
      const len = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      const base = { wayId: w.id, lengthM: len, maxspeedMph: 30, ...(w.roundabout && { roundabout: true }) };
      edges.push({ id: `${w.id}:${i}:f`, from: a, to: b, points: pts, ...base });
      if (!w.oneway) edges.push({ id: `${w.id}:${i}:b`, from: b, to: a, points: [...pts].reverse(), ...base });
      link(a, b);
      link(b, a);
    }
  }
  const junctions: Junction[] = [...degree]
    .filter(([, n]) => n.size >= 3)
    .map(([id, n]) => ({
      id,
      type: ways.some((w) => w.roundabout && w.nodes.includes(id)) ? 'roundabout' : 'plain',
      pos: pos[id],
      lat: 0,
      lng: 0,
      degree: n.size,
      geometryConfidence: 'high',
    }));
  for (const c of controls) {
    const j = junctions.find((j) => j.id === c.junctionId);
    if (j && c.type !== 'crossing') j.type = c.type;
  }
  return {
    centre: { id: 'test', name: 'Test', lat: 0, lng: 0, radiusM: 500 },
    generatedAt: '',
    roads,
    buildings: [],
    junctions,
    controls,
    graph: { nodes: Object.entries(pos).map(([id, p]) => ({ id, pos: p })), edges },
  };
}

const def = (waypoints: string[], parkedCars = 0): RouteDef => ({ id: 't', name: 'Test', waypoints, parkedCars });

// A T-junction: Main Road runs west–east through J; Side Road goes south from J.
//   W ---- J ---- E
//          |
//          S
const T_POS: Record<string, Vec2> = { W: [-200, 0], J: [0, 0], E: [200, 0], S: [0, 200] };
const T_WAYS: WaySpec[] = [
  { id: 1, nodes: ['W', 'J', 'E'], highway: 'primary', name: 'Main Road' },
  { id: 2, nodes: ['J', 'S'], name: 'Side Road' },
];

describe('turns at a T-junction', () => {
  const world = makeWorld(T_POS, T_WAYS);

  it('coming up the side road and turning east is a right turn, giving way to the main road', () => {
    const r = buildRoute(world, def(['S', 'J', 'E']));
    const s = r.steps[0];
    expect(s).toMatchObject({ junctionId: 'J', action: 'right', control: 'giveway', fromRoad: 'Side Road', toRoad: 'Main Road' });
    expect(s.turnDeg).toBeCloseTo(-90);
    expect(s.line?.kind).toBe('giveway');
  });

  it('turning off the main road needs no give-way', () => {
    const fromWest = buildRoute(world, def(['W', 'J', 'S'])).steps[0];
    expect(fromWest).toMatchObject({ action: 'right', control: 'none' });
    expect(fromWest.line).toBeUndefined();
    expect(buildRoute(world, def(['E', 'J', 'S'])).steps[0]).toMatchObject({ action: 'left', control: 'none' });
  });

  it('carrying straight on along the main road is not a step', () => {
    const r = buildRoute(world, def(['W', 'E']));
    expect(r.steps.map((s) => s.action)).toEqual(['end']);
  });

  it('a minor road ending at a T gives way even onto a road of the same kind', () => {
    const same = makeWorld(T_POS, [{ ...T_WAYS[0], highway: 'residential' }, T_WAYS[1]]);
    expect(buildRoute(same, def(['S', 'J', 'W'])).steps[0]).toMatchObject({ action: 'left', control: 'giveway' });
  });

  it('the give-way line sits before the junction patch across the left half of the side road', () => {
    const line = buildRoute(world, def(['S', 'J', 'E'])).steps[0].line!;
    // Junction patch radius is the widest road's half width (3.2 m), then a 1 m gap.
    expect(line.a[1]).toBeCloseTo(4.2);
    expect(line.b[1]).toBeCloseTo(4.2);
    // Heading north, left is west: from the left kerb (x = -3.2) to the centre line (x = 0).
    expect(line.a[0]).toBeCloseTo(-3.2);
    expect(line.b[0]).toBeCloseTo(0);
    expect(line.atM).toBeCloseTo(200 - 4.2, 0);
  });

  it('uses a mapped give-way sign on the approach', () => {
    const signed = makeWorld(T_POS, [{ ...T_WAYS[0], highway: 'residential' }, { ...T_WAYS[1], name: undefined }], [
      { osmId: 9, type: 'stop', pos: [0, 10], junctionId: 'J' },
    ]);
    expect(buildRoute(signed, def(['S', 'J', 'E'])).steps[0].control).toBe('stop');
  });
});

describe('signals', () => {
  it('lights make a step even going straight on, with a stop line', () => {
    const pos: Record<string, Vec2> = { A: [-200, 0], X: [0, 0], B: [200, 0] };
    const world = makeWorld(pos, [{ id: 1, nodes: ['A', 'X', 'B'], name: 'High Street' }]);
    world.junctions.push({ id: 'X', type: 'signals', pos: [0, 0], lat: 0, lng: 0, degree: 2, geometryConfidence: 'high' });
    const s = buildRoute(world, def(['A', 'B'])).steps[0];
    expect(s).toMatchObject({ junctionId: 'X', action: 'ahead', control: 'signals' });
    expect(s.line?.kind).toBe('stop');
  });
});

// A four-arm roundabout. The ring runs clockwise seen from above (UK): N → E → S → W → N.
const R_POS: Record<string, Vec2> = {
  N: [0, -20], E: [20, 0], S: [0, 20], W: [-20, 0],
  n: [0, -200], e: [200, 0], s: [0, 200], w: [-200, 0], car: [-20, 60],
};
const R_WAYS: WaySpec[] = [
  { id: 1, nodes: ['N', 'E', 'S', 'W', 'N'], roundabout: true, oneway: true, highway: 'primary' },
  { id: 2, nodes: ['N', 'n'], name: 'North Road', highway: 'primary' },
  { id: 3, nodes: ['E', 'e'], name: 'East Road', highway: 'primary' },
  { id: 4, nodes: ['S', 's'], name: 'South Road', highway: 'primary' },
  { id: 5, nodes: ['W', 'w'], name: 'West Road', highway: 'primary' },
  { id: 6, nodes: ['W', 'car'], highway: 'service' },
];

describe('roundabouts', () => {
  const world = makeWorld(R_POS, R_WAYS);

  it.each([
    ['w', 1, 'West Road'],
    ['n', 2, 'North Road'],
    ['e', 3, 'East Road'],
  ])('entering from the south, leaving to %s is exit %i', (to, exit, toRoad) => {
    const s = buildRoute(world, def(['s', to])).steps[0];
    expect(s).toMatchObject({ junctionId: 'S', action: 'roundabout', control: 'roundabout', exit, exits: 4, toRoad });
    expect(s.line?.kind).toBe('giveway');
  });

  it('going all the way round is the last exit', () => {
    const s = buildRoute(world, def(['s', 'W', 'S', 's'])).steps[0];
    expect(s).toMatchObject({ exit: 4, exits: 4, toRoad: 'South Road' });
  });
});

describe('route', () => {
  const world = makeWorld(T_POS, T_WAYS);

  it('joins up end to end, with the driving line in the left lane', () => {
    const r = buildRoute(world, def(['W', 'J', 'S']));
    const edges = r.edges.map((id) => world.graph.edges.find((e) => e.id === id)!);
    edges.slice(1).forEach((e, i) => expect(e.from).toBe(edges[i].to));
    expect(edges[0].from).toBe('W');
    expect(edges[edges.length - 1].to).toBe('S');
    // Heading east on a two-way 6.4 m road: the left lane centre is 1.6 m north (z = -1.6).
    expect(r.line[0]).toEqual([-200, -1.6]);
    expect(r.lineM.every((m, i) => i === 0 || m > r.lineM[i - 1])).toBe(true);
    expect(r.lengthM).toBe(r.lineM[r.lineM.length - 1]);
    expect(r.start.heading).toBeCloseTo(0);
    expect(r.steps[r.steps.length - 1]).toMatchObject({ action: 'end', atM: r.lengthM });
  });

  it('never drives the wrong way down a one-way street', () => {
    const oneway = makeWorld(T_POS, [T_WAYS[0], { ...T_WAYS[1], oneway: true }]);
    expect(() => shortestPath(new RoadIndex(oneway), 'S', 'J')).toThrow(/no legal path/);
    expect(shortestPath(new RoadIndex(oneway), 'J', 'S')).toHaveLength(1);
  });

  it('parks cars on side streets off the route, at the left kerb clear of junctions', () => {
    // Route along Main Road; Side Road (80 m long) leads off it to the south.
    const near = makeWorld({ ...T_POS, S: [0, 80] }, T_WAYS);
    const r = buildRoute(near, def(['W', 'J', 'E'], 3));
    // Only one side street, and one car per street.
    expect(r.parkedCars).toHaveLength(1);
    const [car] = r.parkedCars;
    // Halfway down Side Road heading south: the left kerb is east, so a 1.8 m car 0.2 m off it is at x = 2.1.
    expect(car.pos[0]).toBeCloseTo(2.1);
    expect(car.pos[1]).toBeCloseTo(40);
    expect(Math.hypot(car.pos[0], car.pos[1])).toBeGreaterThanOrEqual(PARK_CLEAR_M);
  });

  it('never parks on the route itself, or on streets too far from it', () => {
    expect(buildRoute(makeWorld(T_POS, T_WAYS), def(['W', 'J', 'E'], 3)).parkedCars).toEqual([]);
  });
});

describe('leftLaneOffset', () => {
  it('keeps to the left half of a two-way road even when OSM says one lane', () => {
    expect(leftLaneOffset({ widthM: 3.2, lanes: 1, oneway: false })).toBeCloseTo(-0.8);
    expect(leftLaneOffset({ widthM: 6.4, lanes: 2, oneway: false })).toBeCloseTo(-1.6);
    expect(leftLaneOffset({ widthM: 3.2, lanes: 1, oneway: true })).toBeCloseTo(0);
  });
});

describe('bad route definitions', () => {
  it('says which waypoint is repeated', () => {
    expect(() => buildRoute(makeWorld(T_POS, T_WAYS), def(['W', 'W', 'E']))).toThrow(/W is repeated/);
  });
});

describe('actionFor', () => {
  it('small heading changes are straight on', () => {
    expect(actionFor(10)).toBe('ahead');
    expect(actionFor(-29)).toBe('ahead');
    expect(actionFor(45)).toBe('left');
    expect(actionFor(-90)).toBe('right');
  });
});
