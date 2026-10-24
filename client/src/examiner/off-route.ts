import { OFF_ROUTE_M } from './director';

// When the car has left the route (a missed turn, a wrong exit), in any mode with a route: the sim then finds
// a way back (world/reroute.ts) and the examiner says so, instead of going quiet. Pure, on sim time.

/** Off the route this long before saying it, so cutting a corner or a wide turn doesn't count. */
export const OFF_ROUTE_S = 3;
/** Back on the route this long before it can be said again. */
export const BACK_ON_S = 5;
/** LastOnRoute: a bigger jump along the route than this isn't driving, it's the car's place snapping elsewhere. */
export const MAX_GAP_M = 50;
/** LastOnRoute: such a jump counts once the car has stayed this long within this distance of the route there. */
export const SETTLE_S = 3;
export const SETTLE_M = 8;

export class OffRoute {
  private offSince: number | null = null;
  private onSince: number | null = null;
  private said = false;

  reset() {
    this.offSince = this.onSince = null;
    this.said = false;
  }

  /** True once (per trip off the route) when the car has left it. `offM`: how far it is from the driving line. */
  update(t: number, offM: number): boolean {
    if (offM <= OFF_ROUTE_M) {
      this.offSince = null;
      this.onSince ??= t;
      if (this.said && t - this.onSince >= BACK_ON_S) this.said = false;
      return false;
    }
    this.onSince = null;
    this.offSince ??= t;
    if (this.said || t - this.offSince < OFF_ROUTE_S) return false;
    this.said = true;
    return true;
  }
}

/**
 * Where the car was along the route the last time it was on it: where a way back is found from. On a loop
 * route the car's place can snap to another leg passing nearby while it's off the route, so a jump only
 * counts once the car has stayed on the route there for a while. Pure, on sim time.
 */
export class LastOnRoute {
  m = 0;
  private jumpSince: number | null = null;

  /** The car was put `m` along the route on purpose (start, reset, repeat, a new way back). */
  set(m: number) {
    this.m = m;
    this.jumpSince = null;
  }

  update(t: number, m: number, offM: number) {
    if (offM > OFF_ROUTE_M) return;
    if (Math.abs(m - this.m) <= MAX_GAP_M) return this.set(m);
    if (offM > SETTLE_M) {
      this.jumpSince = null;
      return;
    }
    this.jumpSince ??= t;
    if (t - this.jumpSince >= SETTLE_S) this.set(m);
  }
}
