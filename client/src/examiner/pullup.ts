// When the drive is over (SPEC §4.7): the examiner has asked the learner to pull up on the left, the
// car is near the end of the route, and it has stood still for a moment. Pure, on sim time.

/** Slower than this counts as stopped. */
export const STOPPED_MPH = 0.5;
export const STOPPED_S = 1;
/** The pull-up only counts this close to the end, in case the car's place on the route jumped ahead by mistake. */
export const NEAR_END_M = 150;

export class PullUp {
  private stoppedSince: number | null = null;

  constructor(private routeLengthM: number) {}

  reset() {
    this.stoppedSince = null;
  }

  /** True once the car has pulled up after being asked to. */
  update(t: number, routeM: number, speedMph: number, asked: boolean): boolean {
    if (!asked || routeM < this.routeLengthM - NEAR_END_M || Math.abs(speedMph) >= STOPPED_MPH) {
      this.stoppedSince = null;
      return false;
    }
    this.stoppedSince ??= t;
    return t - this.stoppedSince >= STOPPED_S;
  }
}
