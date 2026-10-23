import { describe, expect, it } from 'vitest';
import demo from '../../../assets/wanstead/route-demo.json';
import type { Route } from '../world/types';
import { placeOf } from './place';

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
