import type { RouteStep } from '../world/types';
import type { RuleId } from './types';

// "Your weak junctions" on the start card (SPEC §16, row 18): where this learner keeps going wrong, from their
// own past drives in Atlas. The server groups their faults by junction and rule (sessions.ts); this turns the
// groups into the few rows the card shows. Pure, so it can be tested. Only junctions on a route count: a
// junction needs a name, and a route through it for the Practise button.

/** Faults of one rule at one junction (and, for R7, every way the learner didn't look), and the drives they were on. */
export interface FaultGroup {
  junctionId: string;
  ruleId: RuleId;
  missed?: string[];
  sessionIds: string[];
}

/** A past drive on a route (free drives have none, so they never count). Newest first. */
export interface PastDrive {
  sessionId: string;
  routeId: string;
}

export interface WeakJunction {
  junctionId: string;
  /** The roads that meet there, e.g. "Kingswood Road / Percy Road". */
  name: string;
  /** What goes wrong there, e.g. "missed the look right". */
  what: string;
  /** Drives with that fault there, and drives through the junction. */
  times: number;
  drives: number;
  /** The route of the latest drive through it, for the Practise button. */
  routeId: string;
}

/** Once could be a slip; a junction is only weak when the same thing went wrong there on two drives. */
export const MIN_TIMES = 2;
export const MAX_SHOWN = 3;

const WHAT: Record<Exclude<RuleId, 'R7'>, string> = {
  R1: 'went over the speed limit',
  R2: 'went through a red light',
  R3: 'no mirror check before signalling',
  R4: 'no mirror check before turning',
  R5: 'no signal',
  R6: 'wrong signal',
  R8: 'no checks before moving off',
  R9: 'wrong lane on the roundabout',
  R11: 'hit something',
  R15: 'tell me question',
};

export function whatWentWrong(g: Pick<FaultGroup, 'ruleId' | 'missed'>): string {
  if (g.ruleId !== 'R7') return WHAT[g.ruleId];
  const missed = g.missed ?? [];
  return missed.length === 1 ? `missed the look ${missed[0] === 'left' ? 'left' : 'right'}` : "didn't look both ways";
}

/** "Wellesley Road / Hermon Hill", "High Street" (straight on), "A1008 / Harrier Avenue roundabout". */
export function junctionName(s: Pick<RouteStep, 'fromRoad' | 'toRoad' | 'action'>): string {
  const roads = [...new Set([s.fromRoad, s.toRoad].filter(Boolean))];
  const name = roads.join(' / ') || 'Unnamed road';
  return s.action === 'roundabout' ? `${name} roundabout` : name;
}

/**
 * The learner's weak junctions, worst first: most drives with the same fault there, then the highest share
 * of drives through it. `stepsOf` gives a route's steps (undefined for a route it doesn't have).
 */
export function weakJunctions(
  groups: FaultGroup[],
  drives: PastDrive[],
  stepsOf: (routeId: string) => Pick<RouteStep, 'junctionId' | 'fromRoad' | 'toRoad' | 'action'>[] | undefined,
): WeakJunction[] {
  const driveIds = new Set(drives.map((d) => d.sessionId));
  // The worst rule at each junction, counted in drives (a fault marked twice on one drive, e.g. after J, is once).
  const worst = new Map<string, { group: FaultGroup; times: number }>();
  for (const g of groups) {
    const times = new Set(g.sessionIds.filter((id) => driveIds.has(id))).size;
    const now = worst.get(g.junctionId);
    if (times >= MIN_TIMES && (!now || times > now.times)) worst.set(g.junctionId, { group: g, times });
  }
  const out: WeakJunction[] = [];
  for (const [junctionId, { group, times }] of worst) {
    const through = drives.flatMap((d) => {
      const step = stepsOf(d.routeId)?.find((s) => s.junctionId === junctionId);
      return step ? [{ drive: d, step }] : [];
    });
    if (!through.length) continue;
    out.push({
      junctionId,
      name: junctionName(through[0].step),
      what: whatWentWrong(group),
      times,
      // A drive ended early may not have reached it, but it can't have gone wrong more often than it was driven.
      drives: Math.max(through.length, times),
      routeId: through[0].drive.routeId,
    });
  }
  return out.sort((a, b) => b.times - a.times || b.times / b.drives - a.times / a.drives).slice(0, MAX_SHOWN);
}
