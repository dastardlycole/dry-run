import { describe, expect, it } from 'vitest';
import auto1 from '../../../assets/wanstead/route-auto-1.json';
import world from '../../../assets/wanstead/world.json';
import { headingOf, pointAlong } from './geometry';
import { reroute } from './reroute';
import { isReverse, RoadIndex, turnDeg } from './route-build';
import type { Edge, Route, WorldData } from './types';

// Missing a turn on the real Wanstead auto-1 route and finding the way back.

const route = auto1 as Route;
const idx = new RoadIndex(world as WorldData);
const edge = (id: string) => idx.edges.get(id)!;

/** The road straight on at a route step (the one a driver who missed the turn takes). */
function straightOnAt(stepId: string): Edge {
  const s = route.steps.find((x) => x.id === stepId)!;
  const a = edge(s.approachEdgeId);
  const options = (idx.out.get(a.to) ?? []).filter((e) => e.id !== s.exitEdgeId && !isReverse(e, a) && !idx.isService(e));
  return options.reduce((b, e) => (Math.abs(turnDeg(a, e)) < Math.abs(turnDeg(a, b)) ? e : b));
}

/** Where the car is `m` metres down edge `e`, facing along it, after leaving the route at step `stepId`. */
function missed(stepId: string, e: Edge, m = 20) {
  const { p, dir } = pointAlong(e.points, m);
  const s = route.steps.find((x) => x.id === stepId)!;
  return reroute(idx, route, p, headingOf(dir[0], dir[1]), s.atM, 1);
}

describe('reroute', () => {
  const s1 = route.steps.find((s) => s.id === 's1')!;
  const ahead = straightOnAt('s1');
  const back = missed('s1', ahead)!;

  it('finds a way back after going straight past the first turn', () => {
    expect(s1.action).toBe('right');
    expect(back).not.toBeNull();
    expect(back.edges[0]).toBe(ahead.id);
  });

  it('rejoins the rest of the route and ends where it did', () => {
    const rest = route.edges.slice(route.edges.indexOf(s1.exitEdgeId));
    const joinAt = back.edges.findIndex((id) => rest.includes(id));
    expect(joinAt).toBeGreaterThan(0);
    // From the rejoin on, it's the original route unchanged.
    const tail = back.edges.slice(joinAt);
    expect(route.edges.slice(route.edges.length - tail.length)).toEqual(tail);
    expect(back.steps[back.steps.length - 1].junctionId).toBe(route.steps[route.steps.length - 1].junctionId);
    // Comes back early rather than skipping a big part of the drive.
    expect(back.lengthM).toBeGreaterThan(route.lengthM - s1.atM - 200);
  });

  it('never turns straight round, where it sets off or anywhere on the way', () => {
    for (let i = 1; i < back.edges.length; i++) expect(isReverse(edge(back.edges[i]), edge(back.edges[i - 1]))).toBe(false);
  });

  it('numbers its steps apart from the route', () => {
    expect(back.steps.every((s) => s.id.startsWith('r1-s'))).toBe(true);
    expect(back.steps.some((s) => s.action !== 'end')).toBe(true);
  });

  it('gives up when the car is nowhere near a road', () => {
    expect(reroute(idx, route, [99999, 99999], 0, s1.atM, 1)).toBeNull();
  });
});
