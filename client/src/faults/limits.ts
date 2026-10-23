import { nearestOnPolyline } from '../world/geometry';
import type { Edge, Vec2 } from '../world/types';

/** UK default in built-up areas, used when OSM has no maxspeed or the car is off the mapped road. */
export const DEFAULT_LIMIT_MPH = 30;
/** Further than this from every edge: not on a known road. */
const ON_ROAD_M = 15;

/** Speed limit for the car at `pos`, from the nearest of `edges` (the route's, for speed). */
export function speedLimitAt(pos: Vec2, edges: Pick<Edge, 'points' | 'maxspeedMph'>[]): number {
  let best = { d: ON_ROAD_M, limit: DEFAULT_LIMIT_MPH };
  for (const e of edges) {
    const { d } = nearestOnPolyline(e.points, pos);
    if (d < best.d) best = { d, limit: e.maxspeedMph || DEFAULT_LIMIT_MPH };
  }
  return best.limit;
}
