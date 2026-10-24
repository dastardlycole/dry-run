import { countFaults, resultOf } from '../../../client/src/faults/result';
import type { Category, RuleId } from '../../../client/src/faults/types';
import type { Route, RouteStep, Vec2 } from '../../../client/src/world/types';
import type { FaultEventDoc, SessionDoc } from '../../../server/src/sessions';

// Simulated past tests on the demo route (SPEC §4.10), so the debrief's "N of M tests here had a fault" has
// real-looking numbers. Every doc is marked `simulated: true` (and ids start "sim-") so it can be removed and
// shown as simulated in the UI. Faults use only the fault engine's own rules and categories, at the route's
// junctions, and each test's result comes from the same code the sim uses. Pure and seeded: the same options
// always give the same data.

export const SIM_PREFIX = 'sim-';
export const DEFAULT_SESSIONS = 24;
const LEARNERS = 10;
const DAYS_BACK = 21;
/** A steady test-route pace, for fault times along the route. */
const PACE_MS = 7;

export type SimSession = SessionDoc & { simulated: true };
export type SimFault = FaultEventDoc & { simulated: true };
export interface SimLearner {
  _id: string;
  createdAt: Date;
  simulated: true;
}

export interface SeedOptions {
  centreId: string;
  /** The seeded tests are spread over the weeks before this. */
  now: Date;
  toLatLng: (p: Vec2) => [lat: number, lng: number];
  sessions?: number;
  seed?: number;
}

interface Chance {
  ruleId: RuleId;
  category: Category;
  p: number;
  /** Speed at the time, mph: [low, high]. */
  mph: [number, number];
  context?: Record<string, unknown>;
}

const c = (ruleId: RuleId, category: Category, p: number, mph: [number, number], context?: Record<string, unknown>): Chance => ({
  ruleId,
  category,
  p,
  mph,
  context,
});

/** How likely each fault is at a step, by what the step is: roughly where learners really slip up. */
function chancesAt(s: RouteStep): Chance[] {
  const turn = s.action === 'left' || s.action === 'right';
  if (s.action === 'roundabout') {
    return [
      c('R9', 'driving', 0.3, [12, 20], { exit: s.exit }),
      c('R6', 'driving', 0.15, [12, 20]),
      c('R4', 'driving', 0.15, [14, 22]),
      c('R11', 'dangerous', 0.02, [10, 18], { with: 'other' }),
    ];
  }
  if (s.control === 'signals') {
    return [
      ...(turn ? [c('R4', 'driving', 0.15, [8, 15]), c('R5', 'driving', 0.1, [8, 15])] : []),
      c('R2', 'dangerous', 0.05, [18, 27], { light: 'red' }),
    ];
  }
  if (turn && (s.control === 'giveway' || s.control === 'stop')) {
    return [c('R4', 'driving', 0.2, [6, 12]), c('R5', 'driving', 0.12, [6, 12]), c('R3', 'driving', 0.05, [6, 12])];
  }
  if (turn) return [c('R4', 'driving', 0.12, [8, 14]), c('R5', 'driving', 0.1, [8, 14])];
  if (s.action === 'end') return [c('R3', 'driving', 0.08, [5, 10])];
  return [];
}

/** Speeding, once per test at most, on the longer straight stretches. */
const SPEEDING: Chance[] = [c('R1', 'driving', 0.25, [33, 37], { limitMph: 30 }), c('R1', 'serious', 0.2, [41, 45], { limitMph: 30 })];

/** mulberry32: small, fast, seeded. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function buildSeed(route: Pick<Route, 'id' | 'lengthM' | 'steps'>, opts: SeedOptions) {
  const random = rng(opts.seed ?? 1);
  const between = ([lo, hi]: [number, number]) => lo + random() * (hi - lo);
  const count = opts.sessions ?? DEFAULT_SESSIONS;
  const steps = route.steps;
  // The steps a speeding fault can be marked at: the ones after the longest gaps along the route.
  const stretches = steps
    .map((s, i) => ({ s, gap: s.atM - (steps[i - 1]?.atM ?? 0) }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 2)
    .map((x) => x.s);

  const learners: SimLearner[] = [];
  const sessions: SimSession[] = [];
  const events: SimFault[] = [];
  const oldest = opts.now.getTime() - DAYS_BACK * 86_400_000;
  for (let k = 0; k < Math.min(LEARNERS, count); k++) {
    learners.push({ _id: `${SIM_PREFIX}learner-${pad(k + 1, 2)}`, createdAt: new Date(oldest - 86_400_000), simulated: true });
  }

  for (let i = 0; i < count; i++) {
    const sessionId = `${SIM_PREFIX}${pad(i + 1, 3)}`;
    const learnerId = learners[i % learners.length]._id;
    // Spread evenly over the weeks, in the daytime, with a little wobble.
    const day = new Date(oldest + Math.floor(((i + 0.5) / count) * DAYS_BACK) * 86_400_000);
    day.setUTCHours(8 + Math.floor(random() * 8), Math.floor(random() * 60), 0, 0);
    const startedAt = day;
    // Some learners are shakier than others.
    const nerves = 0.5 + random();
    const faults: SimFault[] = [];
    const add = (s: RouteStep, ch: Chance) => {
      const atM = Math.max(0, s.atM - 5 - random() * 20);
      const jitter: Vec2 = [s.pos[0] + (random() - 0.5) * 16, s.pos[1] + (random() - 0.5) * 16];
      const [lat, lng] = opts.toLatLng(jitter);
      faults.push({
        _id: `${sessionId}:${faults.length + 1}`,
        sessionId,
        learnerId,
        centreId: opts.centreId,
        junctionId: s.junctionId,
        ruleId: ch.ruleId,
        category: ch.category,
        ts: new Date(startedAt.getTime() + Math.round((atM / PACE_MS) * 1000)),
        location: { type: 'Point', coordinates: [round6(lng), round6(lat)] },
        speedMph: Math.round(between(ch.mph) * 10) / 10,
        context: { simulated: true, stepId: s.id, ...ch.context },
        simulated: true,
      });
    };
    for (const s of steps) for (const ch of chancesAt(s)) if (random() < ch.p * nerves) add(s, ch);
    for (const ch of SPEEDING) if (random() < ch.p * nerves) add(stretches[Math.floor(random() * stretches.length)], ch);
    faults.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    // Ids follow time order, like the sim's.
    faults.forEach((f, n) => (f._id = `${sessionId}:${n + 1}`));

    const counts = countFaults(faults);
    sessions.push({
      _id: sessionId,
      learnerId,
      centreId: opts.centreId,
      routeId: route.id,
      startedAt,
      endedAt: new Date(startedAt.getTime() + Math.round((route.lengthM / PACE_MS + 30) * 1000)),
      result: resultOf(counts),
      counts,
      simulated: true,
    });
    events.push(...faults);
  }
  return { learners, sessions, events };
}
