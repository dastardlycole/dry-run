import { nearestOnPolyline } from './geometry';
import type { Route, Vec2 } from './types';

// How far along the route the car is. The demo loop starts and ends on the same road, so a plain
// "nearest point" search could jump to the wrong leg; this searches just around the last position.

/** Search window around the last position, in metres along the route. */
const BEHIND_M = 20;
const AHEAD_M = 150;
/**
 * Where the route passes the same spot twice (out and back on one road), both legs can be in the
 * window. Each candidate point scores its distance from the car plus a penalty for each metre of
 * route it would jump beyond JUMP_SLACK_M from where the car was, so the car stays on its own leg.
 */
const JUMP_SLACK_M = 15;
const JUMP_PENALTY = 0.2;
/** Further than this from the window: the car has left it (e.g. reset), so search the whole route. */
const LOST_M = 25;

export class RouteProgress {
  /** Metres along the route's driving line. */
  m = 0;
  /** How far the car is from the driving line, in metres. */
  offM = 0;

  constructor(private route: Pick<Route, 'line' | 'lineM'>) {}

  reset() {
    this.m = 0;
    this.offM = 0;
  }

  update(p: Vec2): number {
    const { line, lineM } = this.route;
    const from = this.indexAt(this.m - BEHIND_M);
    const to = this.indexAt(this.m + AHEAD_M) + 1;
    let hit = { d: Infinity, m: this.m };
    let bestScore = Infinity;
    for (let k = from; k < to; k++) {
      const near = nearestOnPolyline(line, p, k, k + 1);
      const m = lineM[k] + near.t * (lineM[k + 1] - lineM[k]);
      const score = near.d + JUMP_PENALTY * Math.max(0, Math.abs(m - this.m) - JUMP_SLACK_M);
      if (score < bestScore) {
        bestScore = score;
        hit = { d: near.d, m };
      }
    }
    if (hit.d > LOST_M) {
      const any = nearestOnPolyline(line, p);
      hit = { d: any.d, m: lineM[any.k] + any.t * (lineM[any.k + 1] - lineM[any.k]) };
    }
    this.m = hit.m;
    this.offM = hit.d;
    return this.m;
  }

  /** Index of the line point at or before `m`. */
  private indexAt(m: number): number {
    const { lineM } = this.route;
    let lo = 0;
    let hi = lineM.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineM[mid] <= m) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
