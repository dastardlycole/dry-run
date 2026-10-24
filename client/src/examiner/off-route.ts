import { OFF_ROUTE_M } from './director';
import { OFF_ROUTE_LINE } from './phrases';

// When the car leaves the route (a missed turn, a wrong exit), the examiner says so once, in any mode with a
// route, instead of going quiet. Finding a new way back is row 16 (off-route); for now the arrows show it.
// Pure, on sim time.

/** Off the route this long before saying it, so cutting a corner or a wide turn doesn't count. */
export const OFF_ROUTE_S = 3;
/** Back on the route this long before it can be said again. */
export const BACK_ON_S = 5;

export class OffRoute {
  private offSince: number | null = null;
  private onSince: number | null = null;
  private said = false;

  reset() {
    this.offSince = this.onSince = null;
    this.said = false;
  }

  /** The line to say now, or null. `offM`: how far the car is from the route's driving line. */
  update(t: number, offM: number): string | null {
    if (offM <= OFF_ROUTE_M) {
      this.offSince = null;
      this.onSince ??= t;
      if (this.said && t - this.onSince >= BACK_ON_S) this.said = false;
      return null;
    }
    this.onSince = null;
    this.offSince ??= t;
    if (this.said || t - this.offSince < OFF_ROUTE_S) return null;
    this.said = true;
    return OFF_ROUTE_LINE;
  }
}
