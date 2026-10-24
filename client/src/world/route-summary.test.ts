import { describe, expect, it } from 'vitest';
import { junctionCounts, routeSummary } from './route-summary';
import type { RouteStep } from './types';

const step = (action: RouteStep['action'], control: RouteStep['control'] | undefined, atM: number) => ({ action, control, atM });

describe('routeSummary', () => {
  it('counts nearby nodes of one junction once', () => {
    const steps = [
      step('ahead', 'signals', 330),
      step('ahead', 'signals', 356),
      step('ahead', 'giveway', 362),
      step('left', 'none', 485),
      step('right', 'giveway', 1013),
      step('roundabout', 'roundabout', 1500),
      step('left', 'signals', 2669),
      step('end', 'none', 2998),
    ] as RouteStep[];
    expect(junctionCounts(steps)).toEqual({ turns: 3, roundabouts: 1, lights: 2, giveWays: 2 });
    expect(routeSummary({ lengthM: 2998, steps })).toBe('3.0 km · 3 turns · 1 roundabout · 2 sets of lights · 2 give-ways');
  });

  it('leaves out kinds the route has none of', () => {
    expect(routeSummary({ lengthM: 1200, steps: [step('left', 'none', 100)] as RouteStep[] })).toBe('1.2 km · 1 turn');
  });
});
