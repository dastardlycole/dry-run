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
  /** Controls at each point and time. Anything left out is off. */
  controls?: (m: number, t: number) => Partial<Pick<Frame, 'indicator' | 'mirror' | 'offRouteM'>>;
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
    const speedMph = mphAt(m);
    const c = s.controls?.(m, t) ?? {};
    frames.push({
      t,
      pos: pointAlong(route.line, m).p,
      speedMph,
      indicator: c.indicator ?? 'off',
      mirror: c.mirror ?? false,
      routeM: m,
      offRouteM: c.offRouteM ?? 0,
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
 * turn (never before the last turn is done), and a second mirror check just before turning.
 */
export function carefulControls(route: Pick<Route, 'steps'>, mph: number) {
  const v = mph / MPH_PER_MS;
  const turns = route.steps.filter(isTurn).map((s, i, all) => {
    const at = turnPointM(s);
    const prevAt = i > 0 ? turnPointM(all[i - 1]) : -Infinity;
    // Not before the start, so there's room for the mirror check first.
    const signalFrom = Math.max(at - 80, prevAt + 5, 15);
    return { at, signalFrom, want: expectedSignal(s) };
  });
  return (m: number) => {
    const mirror = turns.some(
      (x) =>
        (m >= x.signalFrom - 15 && m < x.signalFrom - 5) ||
        (m >= x.at - (MIRROR_BEFORE_TURN_S - 2) * v && m < x.at - (MIRROR_BEFORE_TURN_S - 3) * v),
    );
    const signalling = turns.find((x) => m >= x.signalFrom && m <= x.at + 5);
    return { mirror, indicator: signalling?.want ?? 'off' } as const;
  };
}
