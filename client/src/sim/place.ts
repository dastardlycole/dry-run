import type { Fault } from '../faults/types';
import { nearestOnPolyline } from '../world/geometry';
import type { Road, RouteStep } from '../world/types';

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
  let best = { d: Infinity, name: '' };
  for (const r of roads) {
    if (!r.name) continue;
    const { d } = nearestOnPolyline(r.points, f.pos);
    if (d < best.d) best = { d, name: r.name };
  }
  return best.name ? `near ${best.name}` : 'off the mapped roads';
}
