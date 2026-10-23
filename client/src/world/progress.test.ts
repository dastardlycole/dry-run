import { describe, expect, it } from 'vitest';
import { RouteProgress } from './progress';
import type { Vec2 } from './types';

// An out-and-back route: 100 m east along z = 0, a U-turn, then 100 m back west along z = -4
// (the other lane of the same road, 4 m away).
const line: Vec2[] = [[0, 0], [100, 0], [100, -4], [0, -4]];
const lineM = [0, 100, 104, 204];

describe('RouteProgress', () => {
  it('follows the car along the route', () => {
    const p = new RouteProgress({ line, lineM });
    expect(p.update([10, 0.5])).toBeCloseTo(10);
    expect(p.update([60, 0])).toBeCloseTo(60);
    expect(p.update([100, -2])).toBeCloseTo(102);
    expect(p.update([50, -4])).toBeCloseTo(154);
  });

  it('says which side of the line the car is on, facing along the route', () => {
    const p = new RouteProgress({ line, lineM });
    // Going east, right is south (+z).
    p.update([10, 0.5]);
    expect(p.sideM).toBeCloseTo(0.5);
    p.update([20, -1]);
    expect(p.sideM).toBeCloseTo(-1);
    // Coming back west, right is north (−z).
    p.update([100, -2]);
    p.update([50, -5]);
    expect(p.sideM).toBeCloseTo(1);
  });

  it('stays on the outward leg even though the way back is only 4 m away', () => {
    const p = new RouteProgress({ line, lineM });
    p.update([10, 0]);
    // Drifting towards the other lane: nearest overall is the way back, but we're still going out.
    expect(p.update([20, -2.5])).toBeCloseTo(20);
  });

  it('finds the car again after a jump along the road, and after a reset', () => {
    const p = new RouteProgress({ line: [[0, 0], [500, 0]], lineM: [0, 500] });
    p.update([5, 0]);
    expect(p.update([400, 1])).toBeCloseTo(400);
    p.reset();
    expect(p.m).toBe(0);
    expect(p.update([5, 0])).toBeCloseTo(5);
  });
});
