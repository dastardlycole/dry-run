import type { Indicator } from '../sim/controls';
import type { RouteStep, Vec2 } from '../world/types';
import type { Fault, FaultContext, Frame } from './types';

// Rules R1–R6 (SPEC §4.6 FR-F3). Each is a plain function of the current frame and what the engine
// remembers about earlier frames: no clocks, no randomness, no 3D. The AI never decides faults.

export const SPEED_MARGIN_MPH = 2;
export const SERIOUS_SPEED_MARGIN_MPH = 10;
export const SPEEDING_S = 2;
export const MIRROR_BEFORE_SIGNAL_S = 3;
export const MIRROR_BEFORE_TURN_S = 5;
export const SIGNAL_BEFORE_TURN_S = 3;
/** A turn only counts when the car is this close to the route's driving line (it really took the route). */
export const ON_ROUTE_M = 8;
/** A bigger jump along the route in one frame is a reset or a lost car, not driving over a line. */
const MAX_STEP_M = 30;

/** What the engine remembers between frames. */
export interface History {
  prev?: Frame;
  /** Last sim time M was held, and the last time each indicator was on. */
  lastMirrorT: number;
  lastOnT: Record<'left' | 'right', number>;
  /** When each indicator was last switched on, and when the car last made a turn on the route. */
  signalFromT: Record<'left' | 'right', number>;
  lastTurnT: number;
  /** When the current speeding spell started (and its +10 mph part), and what's been marked in it. */
  overSince: number | null;
  seriousSince: number | null;
  markedDriving: boolean;
  markedSerious: boolean;
}

export const newHistory = (): History => ({
  lastMirrorT: -Infinity,
  lastOnT: { left: -Infinity, right: -Infinity },
  signalFromT: { left: -Infinity, right: -Infinity },
  lastTurnT: -Infinity,
  overSince: null,
  seriousSince: null,
  markedDriving: false,
  markedSerious: false,
});

export function nearestJunctionId(pos: Vec2, junctions: FaultContext['junctions']): string {
  let best = { id: 'none', d: Infinity };
  for (const j of junctions) {
    const d = Math.hypot(j.pos[0] - pos[0], j.pos[1] - pos[1]);
    if (d < best.d) best = { id: j.id, d };
  }
  return best.id;
}

/** The car drove forwards over distance `atM` along the route between the last frame and this one. */
export function crossed(prev: Frame | undefined, f: Frame, atM: number): boolean {
  return (
    !!prev && prev.routeM < atM && f.routeM >= atM && f.routeM - prev.routeM < MAX_STEP_M && f.offRouteM < ON_ROUTE_M
  );
}

/** Where a step's turn is judged: the give-way line for a roundabout (that's where you signal for it), else the junction. */
export const turnPointM = (s: RouteStep) => (s.action === 'roundabout' ? s.line?.atM ?? s.atM : s.atM);

export const isTurn = (s: RouteStep) => s.action === 'left' || s.action === 'right' || s.action === 'roundabout';

/**
 * The signal a step needs. Roundabouts (UK): left for the first exit, right for exits past straight
 * on, none for straight on.
 */
export function expectedSignal(s: RouteStep): Indicator {
  if (s.action === 'left' || s.action === 'right') return s.action;
  if (s.action !== 'roundabout') return 'off';
  const exit = s.exit ?? 1;
  const exits = s.exits ?? exit;
  if (exit === 1) return 'left';
  return exit * 2 > exits + 1 ? 'right' : 'off';
}

const fault = (f: Frame, ruleId: Fault['ruleId'], category: Fault['category'], junctionId: string, context: Fault['context']): Fault => ({
  ruleId,
  category,
  t: f.t,
  pos: f.pos,
  speedMph: Math.abs(f.speedMph),
  junctionId,
  context,
});

/** R1: more than limit + 2 mph for over 2 s (driving); more than limit + 10 for over 2 s (serious). Once each per spell. */
export function speeding(f: Frame, h: History, ctx: FaultContext): Fault[] {
  const speed = Math.abs(f.speedMph);
  if (speed <= f.limitMph + SPEED_MARGIN_MPH) {
    h.overSince = h.seriousSince = null;
    h.markedDriving = h.markedSerious = false;
    return [];
  }
  const out: Fault[] = [];
  const context = { limitMph: f.limitMph };
  h.overSince ??= f.t;
  if (!h.markedDriving && f.t - h.overSince > SPEEDING_S) {
    h.markedDriving = true;
    out.push(fault(f, 'R1', 'driving', nearestJunctionId(f.pos, ctx.junctions), context));
  }
  if (speed > f.limitMph + SERIOUS_SPEED_MARGIN_MPH) {
    h.seriousSince ??= f.t;
    if (!h.markedSerious && f.t - h.seriousSince > SPEEDING_S) {
      h.markedSerious = true;
      out.push(fault(f, 'R1', 'serious', nearestJunctionId(f.pos, ctx.junctions), context));
    }
  } else h.seriousSince = null;
  return out;
}

/** R2: crossing a stop line at lights showing red (or red and amber). */
export function redLight(f: Frame, h: History, ctx: FaultContext): Fault[] {
  const out: Fault[] = [];
  for (const s of ctx.steps) {
    if (s.control !== 'signals' || s.line?.kind !== 'stop' || !crossed(h.prev, f, s.line.atM)) continue;
    const light = ctx.lightFor(s.approachEdgeId, f.t);
    if (light === 'red' || light === 'redAmber') out.push(fault(f, 'R2', 'dangerous', s.junctionId, { stepId: s.id, light }));
  }
  return out;
}

/** R3: indicator switched on (or to the other side) without a mirror check in the 3 s before. */
export function mirrorBeforeSignal(f: Frame, h: History, ctx: FaultContext): Fault[] {
  const was = h.prev?.indicator ?? 'off';
  if (f.indicator === 'off' || f.indicator === was) return [];
  if (f.t - h.lastMirrorT <= MIRROR_BEFORE_SIGNAL_S) return [];
  return [fault(f, 'R3', 'driving', nearestJunctionId(f.pos, ctx.junctions), { indicator: f.indicator })];
}

/** R4–R6, judged as the car reaches each turn on the route. */
export function turns(f: Frame, h: History, ctx: FaultContext): Fault[] {
  const out: Fault[] = [];
  for (const s of ctx.steps) {
    if (!isTurn(s) || !crossed(h.prev, f, turnPointM(s))) continue;
    const lastTurnT = h.lastTurnT;
    h.lastTurnT = f.t;
    const context = { stepId: s.id, action: s.action, ...(s.exit ? { exit: s.exit } : {}) };
    // R4: no mirror check in the 5 s before the turn.
    if (f.t - h.lastMirrorT > MIRROR_BEFORE_TURN_S) out.push(fault(f, 'R4', 'driving', s.junctionId, context));
    const want = expectedSignal(s);
    if (want === 'off') continue;
    const other = want === 'left' ? 'right' : 'left';
    // R6: the other indicator was showing. That's the fault even if the right one came on too, and
    // it isn't also marked as no signal (R5). A signal still on from the last turn (e.g. left through
    // the lights just before a roundabout) doesn't count: only one switched on since then.
    if (f.t - h.lastOnT[other] <= SIGNAL_BEFORE_TURN_S && h.signalFromT[other] > lastTurnT) {
      out.push(fault(f, 'R6', 'driving', s.junctionId, { ...context, expected: want, shown: other }));
    } else if (f.t - h.lastOnT[want] > SIGNAL_BEFORE_TURN_S) {
      out.push(fault(f, 'R5', 'driving', s.junctionId, { ...context, expected: want }));
    }
  }
  return out;
}
