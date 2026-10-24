import type { Route, RouteStep } from './types';

// The one-line description of a route on the start card: "3.0 km · 6 turns · 4 sets of lights · 5 give-ways".
// Pure, so it can be tested.

/** Junction nodes this close after a junction's first node are that junction (a light-controlled crossroads has several). */
const SAME_JUNCTION_M = 50;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many junctions of each kind the route goes through. */
export function junctionCounts(steps: Pick<RouteStep, 'action' | 'control' | 'atM'>[]) {
  const counts = { turns: 0, roundabouts: 0, lights: 0, giveWays: 0 };
  const lastAt: Partial<Record<keyof typeof counts, number>> = {};
  const add = (kind: keyof typeof counts, atM: number) => {
    const prev = lastAt[kind];
    if (prev !== undefined && atM - prev < SAME_JUNCTION_M) return;
    lastAt[kind] = atM;
    counts[kind]++;
  };
  for (const s of steps) {
    if (s.action === 'roundabout') add('roundabouts', s.atM);
    else if (s.control === 'signals') add('lights', s.atM);
    else if (s.control === 'giveway' || s.control === 'stop') add('giveWays', s.atM);
    // Every left or right is a turn, wherever it is.
    if (s.action === 'left' || s.action === 'right') counts.turns++;
  }
  return counts;
}

export function routeSummary(route: Pick<Route, 'lengthM' | 'steps'>): string {
  const c = junctionCounts(route.steps);
  return [
    `${(route.lengthM / 1000).toFixed(1)} km`,
    plural(c.turns, 'turn'),
    ...(c.roundabouts ? [plural(c.roundabouts, 'roundabout')] : []),
    ...(c.lights ? [plural(c.lights, 'set of lights', 'sets of lights')] : []),
    ...(c.giveWays ? [plural(c.giveWays, 'give-way')] : []),
  ].join(' · ');
}
