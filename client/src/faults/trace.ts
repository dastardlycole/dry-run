import { MPH_PER_MS } from '../sim/controls';
import { pointAlong } from '../world/geometry';
import type { Route } from '../world/types';
import { MIRROR_BEFORE_TURN_S, isTurn, turnPointM, expectedSignal } from './rules';
import type { Frame } from './types';

// Scripted drives along a route, for testing the rules. A real drive recorded in the sim
// (sim.saveTrace() in the dev console) is a Frame[] too and can be run the same way.

export interface DriveScript {
  fromM?: number;
  toM?: number;
  /** Speed at each point; a number for a steady speed. */
  mph: number | ((m: number) => number);
  limitMph?: number;
  /** Seconds stood still at the start before pulling away (moving off, R8). */
  waitS?: number;
  /** Controls at each point and time. Anything left out is off. */
  controls?: (m: number, t: number) => Partial<Pick<Frame, 'indicator' | 'mirror' | 'lookLeft' | 'lookRight' | 'offRouteM' | 'sideM' | 'contact'>>;
  fps?: number;
}

export function drive(route: Pick<Route, 'line' | 'lengthM'>, s: DriveScript): Frame[] {
  const dt = 1 / (s.fps ?? 30);
  const mphAt = typeof s.mph === 'number' ? () => s.mph as number : s.mph;
  const frames: Frame[] = [];
  let m = s.fromM ?? 0;
  let t = 0;
  const end = s.toM ?? route.lengthM;
  while (m <= end) {
    const speedMph = t < (s.waitS ?? 0) ? 0 : mphAt(m);
    const c = s.controls?.(m, t) ?? {};
    frames.push({
      t,
      pos: pointAlong(route.line, m).p,
      speedMph,
      indicator: c.indicator ?? 'off',
      mirror: c.mirror ?? false,
      lookLeft: c.lookLeft ?? false,
      lookRight: c.lookRight ?? false,
      routeM: m,
      offRouteM: c.offRouteM ?? Math.abs(c.sideM ?? 0),
      sideM: c.sideM ?? 0,
      contact: c.contact ?? null,
      limitMph: s.limitMph ?? 30,
    });
    // A stopped car still has frames (waiting at lights), so time always moves on.
    m += (Math.max(speedMph, 0) / MPH_PER_MS) * dt;
    t += dt;
    if (frames.length > 1e6) throw new Error('drive never finishes: speed is 0');
  }
  return frames;
}

/**
 * How a careful driver works the controls on this route at `mph`: mirror, then signal ~80 m before each
 * turn (never before the last turn is done), and a second mirror check just before turning. Looks left
 * then right in the 3 s before each give-way line. When the drive starts with `waitS` stood still, a mirror
 * check and a look over the right shoulder in the last 2 s before pulling away.
 */
export function carefulControls(route: Pick<Route, 'steps'>, mph: number, waitS = 0) {
  const v = mph / MPH_PER_MS;
  const turns = route.steps.filter(isTurn).map((s, i, all) => {
    const at = turnPointM(s);
    const prevAt = i > 0 ? turnPointM(all[i - 1]) : -Infinity;
    // Not before the start, so there's room for the mirror check first.
    const signalFrom = Math.max(at - 80, prevAt + 5, 15);
    return { at, signalFrom, want: expectedSignal(s) };
  });
  const giveWays = route.steps.flatMap((s) => (s.line?.kind === 'giveway' ? [s.line.atM] : []));
  return (m: number, t = Infinity) => {
    const pullingAway = t < waitS && t >= waitS - 2;
    const mirror =
      pullingAway ||
      turns.some(
        (x) =>
          (m >= x.signalFrom - 15 && m < x.signalFrom - 5) ||
          (m >= x.at - (MIRROR_BEFORE_TURN_S - 2) * v && m < x.at - (MIRROR_BEFORE_TURN_S - 3) * v),
      );
    const lookLeft = giveWays.some((at) => m >= at - 3 * v && m < at - 2 * v);
    const lookRight = pullingAway || giveWays.some((at) => m >= at - 2 * v && m < at - v);
    const signalling = turns.find((x) => m >= x.signalFrom && m <= x.at + 5);
    return { mirror, lookLeft, lookRight, indicator: signalling?.want ?? 'off' } as const;
  };
}
