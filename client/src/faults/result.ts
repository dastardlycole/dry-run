import type { Category } from './types';

// The test result (SPEC §4.6 FR-F2). Shared with the server, which works it out again from the
// faults saved in Atlas rather than trusting the client's answer. Keep this file free of browser code.

/** The real test's limit, for about 40 minutes of driving. */
export const MAX_DRIVING_FAULTS = 15;
/** How far 40 minutes of town driving goes, roughly: a route this long gets the full 15. */
export const FULL_TEST_M = 12_000;

/**
 * The most driving faults a pass allows on a route `lengthM` long: the real test's 15, scaled to the
 * distance (rounded up, so the learner gets the benefit) and never more than 15. 3 km allows 4.
 * Without a length (an old session), the real 15.
 */
export function drivingFaultLimit(lengthM?: number): number {
  if (!lengthM || lengthM <= 0) return MAX_DRIVING_FAULTS;
  return Math.min(MAX_DRIVING_FAULTS, Math.ceil((MAX_DRIVING_FAULTS * lengthM) / FULL_TEST_M));
}

/** UNFINISHED: ended before the end of the route (Enter early, or R part-way). Never a pass. */
export type Result = 'PASS' | 'FAIL' | 'UNFINISHED';
export type Counts = Record<Category, number>;

export function countFaults(faults: { category: Category }[]): Counts {
  const counts: Counts = { driving: 0, serious: 0, dangerous: 0 };
  for (const f of faults) counts[f.category]++;
  return counts;
}

/** FAIL for more than `limit` driving faults (see drivingFaultLimit), or any serious or dangerous fault. */
export function wouldFail(counts: Counts, limit = MAX_DRIVING_FAULTS): boolean {
  return counts.driving > limit || counts.serious > 0 || counts.dangerous > 0;
}

/** UNFINISHED when the route wasn't driven to the end; otherwise PASS or FAIL from the faults. */
export function resultOf(counts: Counts, finished = true, limit = MAX_DRIVING_FAULTS): Result {
  if (!finished) return 'UNFINISHED';
  return wouldFail(counts, limit) ? 'FAIL' : 'PASS';
}
