import type { Indicator } from '../sim/controls';
import type { Light } from '../world/lights';
import type { RouteStep, Vec2 } from '../world/types';

// Fault engine types (SPEC §4.6). The engine only ever sees these plain values, never Three.js or
// Rapier objects, so a recorded trace of frames always gives the same faults.

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
export type Category = 'driving' | 'serious' | 'dangerous';

export const RULE_NAMES: Record<RuleId, string> = {
  R1: 'Speeding',
  R2: 'Red light',
  R3: 'Mirror before signal',
  R4: 'Mirror before turn',
  R5: 'No signal before turn',
  R6: 'Wrong signal',
};

/** What the car is doing at one moment. One per rendered frame. */
export interface Frame {
  /** Sim time in seconds (stops while paused). */
  t: number;
  pos: Vec2;
  speedMph: number;
  indicator: Indicator;
  /** M held down this frame. */
  mirror: boolean;
  /** Distance along the route's driving line, and how far the car is from it. */
  routeM: number;
  offRouteM: number;
  /** Speed limit of the road the car is on. */
  limitMph: number;
}

/** Fixed facts about the drive the rules check against. */
export interface FaultContext {
  steps: RouteStep[];
  /** The light facing a car arriving on `edgeId` at sim time `t` (TrafficLights.stateFor). */
  lightFor: (edgeId: string, t: number) => Light | undefined;
  /** For faults not tied to a route step, the nearest of these is the junction. */
  junctions: { id: string; pos: Vec2 }[];
}

/** A fault as the engine finds it, before it's stamped with session details. */
export interface Fault {
  ruleId: RuleId;
  category: Category;
  t: number;
  pos: Vec2;
  speedMph: number;
  junctionId: string;
  context: Record<string, unknown>;
}

/** One `fault_events` document (SPEC §7). */
export interface FaultEvent {
  _id: string;
  sessionId: string;
  learnerId: string;
  centreId: string;
  junctionId: string;
  ruleId: RuleId;
  category: Category;
  /** ISO time: the session start plus sim time, so a replayed trace gives the same value. */
  ts: string;
  location: { type: 'Point'; coordinates: [lng: number, lat: number] };
  speedMph: number;
  context: Record<string, unknown>;
}
