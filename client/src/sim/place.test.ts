import { describe, expect, it } from 'vitest';
import demo from '../../../assets/wanstead/route-demo.json';
import wanstead from '../../../assets/wanstead/world.json';
import type { Road, Route } from '../world/types';
import { areaOf, placeOf, roadAt } from './place';

const route = demo as Route;
const step = (id: string) => route.steps.find((s) => s.id === id)!;

describe('placeOf', () => {
  it('names the step the fault was marked at, even where the route passes a junction twice', () => {
    expect(step('s1').junctionId).toBe(step('s8').junctionId);
    const at = (stepId: string) => placeOf({ junctionId: step(stepId).junctionId, pos: step(stepId).pos, context: { stepId } }, route.steps, []);
    expect(at('s1')).toBe('Hermon Hill / High Street');
    expect(at('s8')).toBe('New Wanstead / Hermon Hill');
  });

  it('falls back to the nearest named road for faults not at a route step', () => {
    const roads = [
      { name: 'Far Road', points: [[0, 100], [100, 100]] as [number, number][] },
      { name: 'Near Road', points: [[0, 5], [100, 5]] as [number, number][] },
      { points: [[0, 0], [100, 0]] as [number, number][] },
    ];
    expect(placeOf({ junctionId: 'osm-node-1', pos: [50, 0], context: {} }, route.steps, roads)).toBe('near Near Road');
    expect(placeOf({ junctionId: 'osm-node-1', pos: [50, 0], context: {} }, route.steps, [])).toBe('off the mapped roads');
  });
});

describe('roadAt', () => {
  const roads = [
    { name: 'Far Road', points: [[0, 100], [100, 100]] as [number, number][] },
    { name: 'Near Road', points: [[0, 5], [100, 5]] as [number, number][] },
    { points: [[0, 0], [100, 0]] as [number, number][] },
  ];

  it('names the nearest named road, skipping unnamed ones', () => {
    expect(roadAt(roads, [50, 0])).toBe('Near Road');
    expect(roadAt(roads, [50, 98])).toBe('Far Road');
  });

  it('stays on the road it was on when passing a side road', () => {
    // Main Road runs east; Side Road joins from the north, its centre line ending at the junction.
    const junction = [
      { name: 'Main Road', points: [[0, 0], [100, 0]] as [number, number][] },
      { name: 'Side Road', points: [[50, 0], [50, -60]] as [number, number][] },
    ];
    const car: [number, number] = [50.5, -2]; // in the lane on the side road's side, level with the junction
    expect(roadAt(junction, car)).toBe('Side Road');
    expect(roadAt(junction, car, 'Main Road')).toBe('Main Road');
    // Turned into the side road: once well clear of Main Road, it's the side road.
    expect(roadAt(junction, [51.5, -20], 'Main Road')).toBe('Side Road');
  });

  it('says nothing when no named road is close', () => {
    expect(roadAt(roads, [50, 50])).toBe('');
    expect(roadAt([], [0, 0])).toBe('');
  });

  it('finds the real road partway along it at Wanstead', () => {
    const roads = wanstead.roads as Road[];
    for (const name of ['Hermon Hill', 'High Street']) {
      const { points } = roads.find((r) => r.name === name && r.points.length > 2)!;
      const [x, z] = points[1];
      expect(roadAt(roads, [x + 2, z])).toBe(name);
    }
  });
});

describe('areaOf', () => {
  it('gives the town from a DVSA address, the centre’s own place first', () => {
    expect(areaOf('Goodmayes', '98 Goodmayes Road, Ilford, Goodmayes')).toBe('Goodmayes, Ilford');
    expect(areaOf('Hornchurch', '75 Station Lane, Hornchurch, Romford')).toBe('Hornchurch, Romford');
    expect(areaOf('Wanstead (London)', '2 Devon House, Hermon Hill, Wanstead')).toBe('Wanstead');
    expect(areaOf('Chingford', 'Doric House, 128 Station Road, Chingford')).toBe('Chingford');
    expect(areaOf('Belvedere', '33 Woolwich Road, Belvedere, Belvedere')).toBe('Belvedere');
    expect(areaOf('Bromley', '121-123 Burnt Ash Lane, BROMLEY')).toBe('Bromley');
  });

  it('falls back to the centre’s name without an address', () => {
    expect(areaOf('Wanstead (London)')).toBe('Wanstead');
    expect(areaOf('Somewhere', 'Unit 4, Station Road')).toBe('Somewhere');
  });
});
