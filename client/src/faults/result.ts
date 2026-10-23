import type { Category } from './types';

// The test result (SPEC §4.6 FR-F2). Shared with the server, which works it out again from the
// faults saved in Atlas rather than trusting the client's answer. Keep this file free of browser code.

export const MAX_DRIVING_FAULTS = 15;

export type Result = 'PASS' | 'FAIL';
export type Counts = Record<Category, number>;

export function countFaults(faults: { category: Category }[]): Counts {
  const counts: Counts = { driving: 0, serious: 0, dangerous: 0 };
  for (const f of faults) counts[f.category]++;
  return counts;
}

/** FAIL for more than 15 driving faults, or any serious or dangerous fault. */
export function resultOf(counts: Counts): Result {
  return counts.driving > MAX_DRIVING_FAULTS || counts.serious > 0 || counts.dangerous > 0 ? 'FAIL' : 'PASS';
}
