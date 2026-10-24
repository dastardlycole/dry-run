import { describe, expect, it } from 'vitest';
import type { Building, Road, Vec2, WorldData } from '../../../client/src/world/types';
import { makeProjection } from './project';
import { addOvertureBuildings, overtureHeightM, type OvertureFeature } from './overture';

const centre = { id: 'test', name: 'Test', lat: 51.56, lng: 0.1, radiusM: 1000 };
const proj = makeProjection(centre.lat, centre.lng);

/** A w × d box at local (x, z), as an Overture feature in lng/lat. */
function box(x: number, z: number, w = 8, d = 10, props: Partial<OvertureFeature['properties']> = {}): OvertureFeature {
  const ring: Vec2[] = [[x, z], [x + w, z], [x + w, z + d], [x, z + d], [x, z]];
  return {
    geometry: { type: 'Polygon', coordinates: [ring.map((p) => [...proj.toLatLng(p)].reverse())] },
    properties: { sources: [{ dataset: 'Microsoft ML Buildings' }], height: 6.2, ...props },
  };
}

const osmHouse: Building = { heightM: 7, footprint: [[100, 100], [108, 100], [108, 110], [100, 110]], kind: 'house' };
// An east-west residential road along z = 0, 6.4 m wide: no building within 3.2 + 2 + 1 m of its centre line.
const road: Road = { wayId: 1, highway: 'residential', lanes: 2, widthM: 6.4, maxspeedMph: 30, oneway: false, layer: 0, confidence: 'low', points: [[-200, 0], [200, 0]] };

const world = (): WorldData =>
  ({ centre, generatedAt: '', roads: [road], buildings: [osmHouse], junctions: [], controls: [], graph: { nodes: [], edges: [] } }) as WorldData;

describe('addOvertureBuildings', () => {
  it('adds an outline in a clear spot, with its height', () => {
    const w = world();
    expect(addOvertureBuildings(w, [box(50, 20)])).toBe(1);
    expect(w.buildings).toHaveLength(2);
    expect(w.buildings[1]).toMatchObject({ heightM: 6.2, from: 'overture' });
    expect(w.buildings[1].footprint).toHaveLength(4);
    expect(w.buildings[1].footprint[0][0]).toBeCloseTo(50, 1);
  });

  it('keeps the OSM building where an Overture outline overlaps it', () => {
    const w = world();
    expect(addOvertureBuildings(w, [box(103, 104)])).toBe(0);
    expect(w.buildings).toEqual([osmHouse]);
  });

  it('allows a neighbour that only touches the OSM building', () => {
    expect(addOvertureBuildings(world(), [box(108.2, 100)])).toBe(1);
  });

  it('never puts a building on a road or on its pavement', () => {
    const w = world();
    expect(addOvertureBuildings(w, [box(0, -5)])).toBe(0); // across the road
    expect(addOvertureBuildings(w, [box(0, 5)])).toBe(0); // on the pavement
    expect(addOvertureBuildings(w, [box(0, 7)])).toBe(1); // a front garden back
  });

  it('drops a big outline with the road running inside it', () => {
    expect(addOvertureBuildings(world(), [box(-150, -60, 300, 120)])).toBe(0);
  });

  it('skips Overture outlines that came from OSM, scraps and ones off the map', () => {
    const w = world();
    const fromOsm = box(50, 20, 8, 10, { sources: [{ dataset: 'OpenStreetMap' }, { dataset: 'Microsoft ML Buildings' }] });
    expect(addOvertureBuildings(w, [fromOsm, box(60, 20, 2, 2), box(1500, 20)])).toBe(0);
  });

  it('replaces earlier Overture buildings when run again', () => {
    const w = world();
    addOvertureBuildings(w, [box(50, 20), box(70, 20)]);
    expect(addOvertureBuildings(w, [box(50, 20)])).toBe(1);
    expect(w.buildings).toHaveLength(2);
  });
});

describe('overtureHeightM', () => {
  it('uses the height, then floors, then 7 m', () => {
    expect(overtureHeightM({ height: 6.137 })).toBe(6.1);
    expect(overtureHeightM({ height: 95 })).toBe(30);
    expect(overtureHeightM({ height: 1 })).toBe(3);
    expect(overtureHeightM({ num_floors: 3 })).toBe(10);
    expect(overtureHeightM({})).toBe(7);
  });
});
