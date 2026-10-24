import type { Fault } from '../faults/types';
import { nearestOnPolyline } from '../world/geometry';
import type { Road, RouteStep, Vec2 } from '../world/types';

/**
 * A fault's place in words, for the result screen: the route step it was marked at if it has one (a
 * route can pass the same junction twice, from different roads), else the nearest named road.
 */
export function placeOf(
  f: Pick<Fault, 'junctionId' | 'pos' | 'context'>,
  steps: RouteStep[],
  roads: Pick<Road, 'name' | 'points'>[],
): string {
  const step = steps.find((s) => s.id === f.context.stepId) ?? steps.find((s) => s.junctionId === f.junctionId);
  if (step) return step.fromRoad === step.toRoad ? step.fromRoad : `${step.fromRoad} / ${step.toRoad}`;
  const name = roadAt(roads, f.pos, '', Infinity);
  return name ? `near ${name}` : 'off the mapped roads';
}

/** How far from a road's centre line the car can be and still be "on" it. */
const ON_ROAD_M = 25;
/**
 * How far it can be from the road it was on and still be on that one. Passing a side road, the side
 * road's centre line runs into the junction close to the car, nearer than the main road's: without this
 * the name would flick to the side road at every junction.
 */
const STAY_M = 10;

/**
 * The named road at `pos` (nearest within `maxM`), for the place line at the top; '' if none. Stays on
 * `current`, the road it was on, while that's within STAY_M.
 */
export function roadAt(roads: Pick<Road, 'name' | 'points'>[], pos: Vec2, current = '', maxM = ON_ROAD_M): string {
  if (current && roads.some((r) => r.name === current && nearestOnPolyline(r.points, pos).d < STAY_M)) return current;
  let best = { d: maxM, name: '' };
  for (const r of roads) {
    if (!r.name) continue;
    const { d } = nearestOnPolyline(r.points, pos);
    if (d < best.d) best = { d, name: r.name };
  }
  return best.name;
}

// Address parts that are a street, unit or building rather than a town: "98 Goodmayes Road", "Unit C1".
const NOT_A_TOWN =
  /\d|\b(road|rd|lane|street|hill|way|avenue|ave|drive|place|parade|close|court|house|centre|estate|park|unit|floor|roundabout|junction|building|buildings|factory|boulevard)\b/i;

/**
 * The area a centre is in, from its DVSA address (street first, town last), with the place the centre is
 * named after first: "98 Goodmayes Road, Ilford, Goodmayes" → "Goodmayes, Ilford". No address: the name.
 */
export function areaOf(centreName: string, address = ''): string {
  const name = centreName.replace(/\s*\(.*\)/, '').trim();
  const same = (a: string) => a.toLowerCase() === name.toLowerCase();
  // "BROMLEY" → "Bromley".
  const tidy = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);
  const parts = address.split(',').map((s) => tidy(s.trim())).filter(Boolean);
  const last = parts.at(-1);
  const before = parts.at(-2);
  // An address with no town at the end ("Unit 4, Station Road"): just the centre's name.
  if (!last || (NOT_A_TOWN.test(last) && !same(last))) return name;
  const towns = [last];
  // The part before the town is a town too ("…, Hornchurch, Romford") when one of the two is the centre's.
  if (before && !NOT_A_TOWN.test(before) && (same(before) || same(last))) towns.push(before);
  towns.sort((a, b) => Number(same(b)) - Number(same(a)));
  return [...new Set(towns)].join(', ');
}
