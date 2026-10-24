import type { Route, RouteStep } from '../world/types';
import { everyTip } from './tips';

// What the examiner says, built from the route's steps (SPEC §4.4 FR-R2). Pure: tools/src/gen-tts.ts
// uses this too, so the cached audio always matches the words the sim asks for.
// Like a real test: "follow the road ahead" is said once at the start, then only turns, roundabouts
// and the final pull-up get a direction. Road names aren't said (examiners mostly don't), so every
// sentence comes from a small fixed set: one batch of Gemini audio covers every centre and route.

export const OPENING = "Follow the road ahead unless traffic signs direct you otherwise. When you're ready, drive on.";

/** Said when the drive ends (SPEC §4.5 FR-E2), as a real examiner says it. */
export const END_PASS = "That's the end of your test. I'm pleased to tell you that you've passed.";
export const END_FAIL = "That's the end of your test. I'm sorry to tell you that you haven't passed.";
/** Said when the car has left the route (off-route.ts), in any mode. */
export const OFF_ROUTE_LINE = "You've gone off the route. When it's safe, turn round and follow the arrows back.";

/** Said when the learner ends the test before the end of the route. */
export const END_UNFINISHED = "We'll stop the test there. As we didn't finish the route, there's no result this time.";

export interface Direction {
  stepId: string;
  /** Distance along the route of the manoeuvre the direction is for. */
  atM: number;
  /** Where its last manoeuvre is: the same as atM, unless a second one was joined on. */
  endM: number;
  text: string;
}

/**
 * A manoeuvre this soon after the last one can't get its own direction in time (at 30 mph: 4 s lead plus
 * the time to say it), so it's joined on: "At the lights, turn left, then at the roundabout, take ...".
 */
export const JOIN_GAP_M = 100;

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** The sentence for one step, or null when nothing needs saying (straight on). */
export function phraseFor(step: RouteStep): string | null {
  switch (step.action) {
    case 'end':
      return "Pull up on the left when it's safe.";
    case 'roundabout': {
      const exit = ORDINALS[(step.exit ?? 1) - 1] ?? `number ${step.exit}`;
      return `At the roundabout, take the ${exit} exit.`;
    }
    case 'left':
    case 'right':
      if (step.control === 'signals') return `At the lights, turn ${step.action}.`;
      if (step.control === 'giveway' || step.control === 'stop') return `At the end of the road, turn ${step.action}.`;
      return `Take the next road on the ${step.action}.`;
    case 'ahead':
      return null;
  }
}

/** Every direction on the route, in driving order. */
export function routeDirections(route: Pick<Route, 'steps'>): Direction[] {
  const out: Direction[] = [];
  let joined = false;
  for (const step of route.steps) {
    const text = phraseFor(step);
    if (!text) continue;
    const prev = out[out.length - 1];
    // Only two in one sentence; a third would be too much to take in.
    if (prev && !joined && step.atM - prev.atM < JOIN_GAP_M) {
      prev.text = `${prev.text} ${then(text)}`;
      prev.endM = step.atM;
      joined = true;
    } else {
      out.push({ stepId: step.id, atM: step.atM, endM: step.atM, text });
      joined = false;
    }
  }
  return out;
}

/** The second of two joined directions, said as its own sentence so it has its own audio. */
const then = (text: string) => `Then ${text[0].toLowerCase()}${text.slice(1)}`;

/** The sentences a direction is said in (a joined one is two). */
export const sentencesOf = (text: string) => text.split(/(?<=\.) (?=Then )/);

/** Every sentence the examiner (or, in practice, the instructor: tips.ts) can say, on any route (for pre-generating audio). */
export function everyPhrase(): string[] {
  const steps: Partial<RouteStep>[] = [
    ...ORDINALS.map((_, i) => ({ action: 'roundabout' as const, exit: i + 1 })),
    ...(['left', 'right'] as const).flatMap((action) =>
      (['signals', 'giveway', 'none'] as const).map((control) => ({ action, control })),
    ),
    { action: 'end' },
  ];
  const directions = steps.map((s) => phraseFor(s as RouteStep)!);
  return [OPENING, ...directions, ...directions.map(then), END_PASS, END_FAIL, END_UNFINISHED, OFF_ROUTE_LINE, ...everyTip()];
}
