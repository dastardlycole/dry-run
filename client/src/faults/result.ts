import type { Category } from './types';

// The test result (SPEC §4.6 FR-F2). Shared with the server, which works it out again from the
// faults saved in Atlas rather than trusting the client's answer. Keep this file free of browser code.

export const MAX_DRIVING_FAULTS = 15;

/** UNFINISHED: ended before the end of the route (Enter early, or R part-way). Never a pass. */
export type Result = 'PASS' | 'FAIL' | 'UNFINISHED';
export type Counts = Record<Category, number>;

export function countFaults(faults: { category: Category }[]): Counts {
  const counts: Counts = { driving: 0, serious: 0, dangerous: 0 };
  for (const f of faults) counts[f.category]++;
  return counts;
}

/** FAIL for more than 15 driving faults, or any serious or dangerous fault. */
export function wouldFail(counts: Counts): boolean {
  return counts.driving > MAX_DRIVING_FAULTS || counts.serious > 0 || counts.dangerous > 0;
}

/** UNFINISHED when the route wasn't driven to the end; otherwise PASS or FAIL from the faults. */
export function resultOf(counts: Counts, finished = true): Result {
  if (!finished) return 'UNFINISHED';
  return wouldFail(counts) ? 'FAIL' : 'PASS';
}
