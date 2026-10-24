import type { RouteStep, StopLine } from '../world/types';

// Practice mode's "repeat the last junction" (J): where to put the car back to.

/** How far before the junction the car is put, so there's time to get up to speed and check mirrors. */
export const REPEAT_BACK_M = 80;
/** The car has to be this far past a junction for it to count as passed. */
const PASSED_M = 5;

/** A give-way or stop line is where a junction is judged (R7, and roundabouts); else the junction itself. */
const judgedAtM = (s: Pick<RouteStep, 'atM'> & { line?: Pick<StopLine, 'atM'> }) => Math.min(s.line?.atM ?? s.atM, s.atM);

/** Metres along the route to put the car for the last junction it passed (at `m`), or null before the first. */
export function repeatFromM(steps: (Pick<RouteStep, 'action' | 'atM'> & { line?: Pick<StopLine, 'atM'> })[], m: number): number | null {
  let at: number | null = null;
  for (const s of steps) {
    if (s.action === 'end') continue;
    const judgedM = judgedAtM(s);
    if (judgedM <= m - PASSED_M && (at === null || judgedM > at)) at = judgedM;
  }
  return at === null ? null : Math.max(0, at - REPEAT_BACK_M);
}

/** Metres along the route to start a drive at junction `junctionId` (a weak junction's Practise button), or null if it isn't on the route. */
export function startBeforeM(
  steps: (Pick<RouteStep, 'action' | 'atM' | 'junctionId'> & { line?: Pick<StopLine, 'atM'> })[],
  junctionId: string,
): number | null {
  const s = steps.find((s) => s.junctionId === junctionId && s.action !== 'end');
  return s ? Math.max(0, judgedAtM(s) - REPEAT_BACK_M) : null;
}
