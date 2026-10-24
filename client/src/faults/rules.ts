import { OFF_ROUTE_M } from '../examiner/director';
import type { Indicator } from '../sim/controls';
import type { RouteStep, Vec2 } from '../world/types';
import type { Fault, FaultContext, Frame } from './types';

// Rules R1–R9 and R11 (SPEC §4.6 FR-F3). Each is a plain function of the current frame and what the engine
// remembers about earlier frames: no clocks, no randomness, no 3D. The AI never decides faults.

export const SPEED_MARGIN_MPH = 2;
export const SERIOUS_SPEED_MARGIN_MPH = 10;
export const SPEEDING_S = 2;
export const MIRROR_BEFORE_SIGNAL_S = 3;
export const MIRROR_BEFORE_TURN_S = 5;
export const SIGNAL_BEFORE_TURN_S = 3;
/** A turn only counts when the car is this close to the route's driving line (it really took the route). */
export const ON_ROUTE_M = 8;
/**
 * A left or right turn is only judged once the car is this far down the exit road (still on the route): going
 * straight past a turn (a missed turn) isn't marked as a turn without a signal. Further than OFF_ROUTE_M from
 * the route first, it was missed, and nothing is marked for it.
 */
export const EXIT_CONFIRM_M = 15;
/** R9 judges the lane from where the car sat over this much road before the give-way line. */
export const LANE_SAMPLE_M = 20;
/** R11: contact this soon after the last one is the same crash (bouncing off and back in, or scraping along a wall). */
export const SAME_CRASH_S = 3;
/** R7: a look (Q / E) counts for a give-way line this long before the car crosses it. */
export const LOOK_BEFORE_LINE_S = 4;
/** R8: the car has moved off once it's faster than this. */
export const MOVING_OFF_MPH = 3;
/** R8: the mirror check and look over the right shoulder count this long before moving off. */
export const MOVING_OFF_CHECK_S = 5;
/** A bigger jump along the route in one frame is a reset or a lost car, not driving over a line. */
const MAX_STEP_M = 30;

/** What the engine remembers between frames. */
export interface History {
  prev?: Frame;
  /** Last sim time M was held, and the last time each indicator was on. */
  lastMirrorT: number;
  /** Last sim time each way was looked (Q / E). */
  lastLookT: Record<'left' | 'right', number>;
  /** R8: the car is pulled up at the side of the road (the start of the drive), so moving off is still to be judged. */
  movingOffArmed: boolean;
  lastOnT: Record<'left' | 'right', number>;
  /** When each indicator was last switched on, and when the car last made a turn on the route. */
  signalFromT: Record<'left' | 'right', number>;
  lastTurnT: number;
  /** Turn faults worked out at the junction, waiting for the car to be seen on the exit road. */
  pendingTurns: { confirmAtM: number; faults: Fault[] }[];
  /** When the current speeding spell started (and its +10 mph part), and what's been marked in it. */
  overSince: number | null;
  seriousSince: number | null;
  markedDriving: boolean;
  markedSerious: boolean;
  /** R9: sum and count of the car's sideM on each roundabout approach, by step id. */
  laneSide: Record<string, { sum: number; n: number }>;
  /** R11: last sim time the car was touching something. */
  lastContactT: number;
}

export const newHistory = (): History => ({
  lastMirrorT: -Infinity,
  lastLookT: { left: -Infinity, right: -Infinity },
  movingOffArmed: true,
  lastOnT: { left: -Infinity, right: -Infinity },
  signalFromT: { left: -Infinity, right: -Infinity },
  lastTurnT: -Infinity,
  pendingTurns: [],
  overSince: null,
  seriousSince: null,
  markedDriving: false,
  markedSerious: false,
  laneSide: {},
  lastContactT: -Infinity,
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

/** What a fault at a route step records about it. */
const stepContext = (s: RouteStep) => ({ stepId: s.id, action: s.action, ...(s.exit ? { exit: s.exit } : {}) });

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

/**
 * R4–R6, judged as the car reaches each turn on the route. A roundabout's are marked there (at its give-way
 * line: you can't drive past one); a left or right turn's are held until the car is on the exit road.
 */
export function turns(f: Frame, h: History, ctx: FaultContext): Fault[] {
  const out: Fault[] = [];
  h.pendingTurns = h.pendingTurns.filter((p) => {
    if (crossed(h.prev, f, p.confirmAtM)) out.push(...p.faults);
    else if (f.offRouteM <= OFF_ROUTE_M) return true;
    return false;
  });
  for (const s of ctx.steps) {
    if (!isTurn(s) || !crossed(h.prev, f, turnPointM(s))) continue;
    const lastTurnT = h.lastTurnT;
    h.lastTurnT = f.t;
    if (s.action === 'roundabout') {
      judgeTurn(f, h, s, lastTurnT, out);
      continue;
    }
    const faults: Fault[] = [];
    judgeTurn(f, h, s, lastTurnT, faults);
    if (faults.length) h.pendingTurns.push({ confirmAtM: s.atM + EXIT_CONFIRM_M, faults });
  }
  return out;
}

/** R4–R6 at turn step `s`, added to `out`. `lastTurnT`: when the turn before it was made. */
function judgeTurn(f: Frame, h: History, s: RouteStep, lastTurnT: number, out: Fault[]) {
  const context = stepContext(s);
  // R4: no mirror check in the 5 s before the turn.
  if (f.t - h.lastMirrorT > MIRROR_BEFORE_TURN_S) out.push(fault(f, 'R4', 'driving', s.junctionId, context));
  const want = expectedSignal(s);
  if (want === 'off') return;
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

/**
 * Lanes and width in the car's direction. OSM counts both directions on a two-way road, so the car
 * gets half (an odd lane out is taken as the other way's, or shared).
 */
export function lanesOneWay(road: { lanes: number; widthM: number; oneway: boolean }): { lanes: number; widthM: number } {
  if (road.oneway) return { lanes: road.lanes, widthM: road.widthM };
  const lanes = Math.max(1, Math.floor(road.lanes / 2));
  return { lanes, widthM: (road.widthM * lanes) / road.lanes };
}

/**
 * R9: on a roundabout approach with two or more lanes, the car was in the wrong lane for its exit.
 * Left lane for the first exit, right lane for exits past straight on, either for straight on.
 * The lane comes from where the car sat across the road (the driving line is the middle of the left
 * lane), averaged over the last LANE_SAMPLE_M before the give-way line. There are no painted lanes yet.
 */
export function roundaboutLane(f: Frame, h: History, ctx: FaultContext): Fault[] {
  const out: Fault[] = [];
  for (const s of ctx.steps) {
    if (s.action !== 'roundabout' || !s.line) continue;
    const found = ctx.roadFor?.(s.approachEdgeId);
    const road = found && lanesOneWay(found);
    if (!road || road.lanes < 2) continue;
    const lineM = s.line.atM;
    const onApproach = f.routeM >= lineM - LANE_SAMPLE_M && f.routeM < lineM;
    if (onApproach && f.offRouteM < ON_ROUTE_M) {
      const acc = (h.laneSide[s.id] ??= { sum: 0, n: 0 });
      acc.sum += f.sideM;
      acc.n++;
    }
    if (!crossed(h.prev, f, lineM)) {
      // Left the approach without crossing the line (reset, jumped, turned away): start afresh next time.
      if (!onApproach) delete h.laneSide[s.id];
      continue;
    }
    const acc = h.laneSide[s.id];
    delete h.laneSide[s.id];
    const side = acc?.n ? acc.sum / acc.n : f.sideM;
    const laneW = road.widthM / road.lanes;
    const lane = Math.min(road.lanes, Math.max(1, Math.round(side / laneW) + 1));
    const want = expectedSignal(s);
    const expectedLane = want === 'left' ? 1 : want === 'right' ? road.lanes : null;
    if (expectedLane !== null && lane !== expectedLane) {
      out.push(fault(f, 'R9', 'driving', s.junctionId, { stepId: s.id, exit: s.exit, lane, expectedLane, lanes: road.lanes }));
    }
  }
  return out;
}

/** R11: the car hit something (not the ground). One fault per crash, however many times it bumps. */
export function collision(f: Frame, h: History, ctx: FaultContext): Fault[] {
  if (!f.contact) return [];
  const newCrash = f.t - h.lastContactT > SAME_CRASH_S;
  h.lastContactT = f.t;
  return newCrash ? [fault(f, 'R11', 'dangerous', nearestJunctionId(f.pos, ctx.junctions), { with: f.contact })] : [];
}

/**
 * R7: crossed a give-way line (or a stop sign's line) without looking in the 4 s before. Both ways (Q and E);
 * only right (E) at a roundabout, where all the traffic comes from the right. Not judged at traffic
 * lights (the light gives priority) or at junctions with no line on the map.
 */
export function junctionObservation(f: Frame, h: History, ctx: FaultContext): Fault[] {
  const out: Fault[] = [];
  for (const s of ctx.steps) {
    const judged = s.line?.kind === 'giveway' || (s.line?.kind === 'stop' && s.control !== 'signals');
    if (!judged || !crossed(h.prev, f, s.line!.atM)) continue;
    const sides: ('left' | 'right')[] = s.action === 'roundabout' ? ['right'] : ['left', 'right'];
    const missed = sides.filter((side) => f.t - h.lastLookT[side] > LOOK_BEFORE_LINE_S);
    if (missed.length) {
      out.push(fault(f, 'R7', 'driving', s.junctionId, { ...stepContext(s), missed }));
    }
  }
  return out;
}

/**
 * R8: pulled away from the side of the road without a mirror check (M) and a look over the right
 * shoulder (E) in the 5 s before. Judged once, at the start of the drive: stopping at lights or a
 * give-way is stopping in traffic, not pulling up, so moving off from there isn't judged.
 */
export function movingOff(f: Frame, h: History, ctx: FaultContext): Fault[] {
  if (!h.movingOffArmed || f.speedMph < MOVING_OFF_MPH) return [];
  h.movingOffArmed = false;
  // Already moving when the drive was first seen (a trace cut from the middle of a drive): nothing to judge.
  if (!h.prev || h.prev.speedMph >= MOVING_OFF_MPH) return [];
  const missed: ('mirror' | 'right')[] = [];
  if (f.t - h.lastMirrorT > MOVING_OFF_CHECK_S) missed.push('mirror');
  if (f.t - h.lastLookT.right > MOVING_OFF_CHECK_S) missed.push('right');
  return missed.length ? [fault(f, 'R8', 'driving', nearestJunctionId(f.pos, ctx.junctions), { missed })] : [];
}
