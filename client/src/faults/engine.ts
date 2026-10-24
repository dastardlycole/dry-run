import type { Vec2 } from '../world/types';
import {
  collision,
  junctionObservation,
  mirrorBeforeSignal,
  movingOff,
  newHistory,
  redLight,
  roundaboutLane,
  speeding,
  turns,
  type History,
} from './rules';
import type { Fault, FaultContext, FaultEvent, Frame } from './types';

// Runs the rules over the drive, one frame at a time (SPEC §4.6). Same frames in → same faults out.

const RULES = [movingOff, speeding, redLight, mirrorBeforeSignal, turns, junctionObservation, roundaboutLane, collision];

export class FaultEngine {
  private h: History = newHistory();

  constructor(private ctx: FaultContext) {}

  reset() {
    this.h = newHistory();
  }

  step(f: Frame): Fault[] {
    const h = this.h;
    // A mirror check, look or indicator showing in this frame counts for this frame's rules.
    if (f.mirror) h.lastMirrorT = f.t;
    if (f.lookLeft) h.lastLookT.left = f.t;
    if (f.lookRight) h.lastLookT.right = f.t;
    if (f.indicator !== 'off') {
      h.lastOnT[f.indicator] = f.t;
      if (f.indicator !== (h.prev?.indicator ?? 'off')) h.signalFromT[f.indicator] = f.t;
    }
    const out = RULES.flatMap((rule) => rule(f, h, this.ctx));
    h.prev = f;
    return out;
  }
}

/** Every fault in a recorded drive. */
export function runTrace(ctx: FaultContext, frames: Frame[]): Fault[] {
  const engine = new FaultEngine(ctx);
  return frames.flatMap((f) => engine.step(f));
}

export interface SessionInfo {
  sessionId: string;
  learnerId: string;
  centreId: string;
  /** Wall-clock ms when sim time was 0. */
  startedAtMs: number;
}

/** Stamps the `n`th fault of a session (from 1) as a `fault_events` document (SPEC §7). */
export function toFaultEvent(
  f: Fault,
  n: number,
  s: SessionInfo,
  toLatLng: (p: Vec2) => [lat: number, lng: number],
): FaultEvent {
  const [lat, lng] = toLatLng(f.pos);
  return {
    _id: `${s.sessionId}:${n}`,
    sessionId: s.sessionId,
    learnerId: s.learnerId,
    centreId: s.centreId,
    junctionId: f.junctionId,
    ruleId: f.ruleId,
    category: f.category,
    ts: new Date(s.startedAtMs + Math.round(f.t * 1000)).toISOString(),
    location: { type: 'Point', coordinates: [round6(lng), round6(lat)] },
    speedMph: Math.round(f.speedMph * 10) / 10,
    context: f.context,
  };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
