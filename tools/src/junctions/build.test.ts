import { describe, expect, it } from 'vitest';
import type { Route, WorldData } from '../../../client/src/world/types';
import { buildJunctionDocs, junctionNames, nearestJunction, notAtJunction, routeJunctionIds } from './build';

const J = (id: string, x: number, z: number, type: WorldData['junctions'][number]['type'] = 'plain') => ({
  id,
  type,
  pos: [x, z] as [number, number],
  lat: 51.5797 - z / 111000,
  lng: 0.0236 + x / 69000,
  degree: 3,
  geometryConfidence: 'high' as const,
});

const world = {
  centre: { id: 'wanstead', name: 'Wanstead', lat: 51.5797, lng: 0.0236, radiusM: 1000 },
  junctions: [J('a', 0, 0, 'signals'), J('b', 100, 0, 'roundabout'), J('c', 100, 200), J('lonely', 500, 500)],
  roads: [
    { wayId: 1, name: 'High Street', points: [] },
    { wayId: 2, name: 'Cambridge Park', points: [] },
    { wayId: 3, points: [] },
  ],
  graph: {
    nodes: [],
    edges: [
      { id: 'e1', from: 'a', to: 'b', wayId: 1 },
      { id: 'e2', from: 'b', to: 'c', wayId: 2 },
      { id: 'e3', from: 'c', to: 'lonely', wayId: 3 },
    ],
  },
} as unknown as WorldData;

const route = {
  id: 'demo',
  line: [
    [-50, 0],
    [100, 0],
  ],
  steps: [{ junctionId: 'c' }],
} as unknown as Route;

describe('nearestJunction', () => {
  it('finds the closest junction within the limit', () => {
    expect(nearestJunction([90, 5], world.junctions)).toEqual({ id: 'b', distM: Math.hypot(10, 5) });
  });
  it('links nothing when every junction is too far', () => {
    expect(nearestJunction([300, 300], world.junctions)).toBeNull();
    expect(nearestJunction([0, 40], world.junctions, 30)).toBeNull();
  });
});

describe('notAtJunction', () => {
  it('is true only for DfT "not at junction"', () => {
    expect(notAtJunction({ junctionDetail: 'Not at junction or within 20 metres' })).toBe(true);
    expect(notAtJunction({ junctionDetail: 'Roundabout' })).toBe(false);
    expect(notAtJunction({ junctionDetail: 'Unknown' })).toBe(false);
  });
});

describe('junctionNames', () => {
  it('names a junction after the roads that meet there', () => {
    const names = junctionNames(world);
    expect(names.get('b')).toBe('Cambridge Park / High Street');
    expect(names.get('a')).toBe('High Street');
  });
  it('falls back to the junction type when no road there is named', () => {
    expect(junctionNames(world).get('lonely')).toBe('Junction');
  });
});

describe('routeJunctionIds', () => {
  it('includes junctions near the driving line and the route steps', () => {
    expect([...routeJunctionIds(route, world.junctions)].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('buildJunctionDocs', () => {
  it('writes SPEC §7 junction docs with collision counts and routes', () => {
    const since = new Date('2021-01-01T00:00:00Z');
    const docs = buildJunctionDocs(
      world,
      [route],
      new Map([['b', [{ severity: 'serious' as const }, { severity: 'slight' as const }, { severity: 'fatal' as const }]]]),
      since,
    );
    expect(docs).toHaveLength(4);
    expect(docs.find((d) => d._id === 'b')).toEqual({
      _id: 'b',
      centreId: 'wanstead',
      type: 'roundabout',
      name: 'Cambridge Park / High Street',
      location: { type: 'Point', coordinates: [0.0236 + 100 / 69000, 51.5797] },
      geometryConfidence: 'high',
      routeIds: ['demo'],
      collisions: { total: 3, serious: 1, fatal: 1, since },
    });
    expect(docs.find((d) => d._id === 'lonely')).toMatchObject({ routeIds: [], collisions: { total: 0 } });
  });
});
