import type { Fault, RuleId } from '../faults/types';

// What the instructor says the moment the fault engine marks a fault in practice mode (SPEC §16, row 17).
// The tips are fixed sentences picked by rule id (and which side or lane, from the fault's context), never
// written by the AI, and have no road names: like the directions, one batch of Gemini audio covers every
// centre (phrases.ts everyPhrase), so the instructor never switches to the browser's voice.

/** Said as a practice drive starts. */
export const PRACTICE_OPENING = "Let's practise. I'll give you a tip whenever something needs work.";

const LOOK = {
  left: 'Look left before you pull out here.',
  right: 'Look right before you pull out here.',
  both: 'Look both ways before you pull out here.',
  roundabout: 'Look right before you join the roundabout.',
};
const LANE = { left: 'Use the left lane for this exit.', right: 'Use the right lane for this exit.' };

/** The tip for each rule that doesn't depend on the fault's context. */
const FIXED: Record<Exclude<RuleId, 'R7' | 'R9'>, string> = {
  R1: 'Watch your speed. Keep to the limit.',
  R2: 'Stop at the line when the light is red or amber.',
  R3: 'Check your mirror before you signal.',
  R4: 'Check your mirror before you turn.',
  R5: 'Signal before you turn.',
  R6: "That was the wrong signal. Signal the way you're going.",
  R8: 'Check your mirror and look over your right shoulder before you move off.',
  R11: 'Careful. Slow down and give it more room.',
  R15: 'Have a look at the right answer after the drive.',
};

export function tipFor(f: Pick<Fault, 'ruleId' | 'context'>): string {
  switch (f.ruleId) {
    case 'R7': {
      if (f.context.action === 'roundabout') return LOOK.roundabout;
      const missed = (f.context.missed as string[] | undefined) ?? [];
      return missed.length === 1 ? LOOK[missed[0] === 'left' ? 'left' : 'right'] : LOOK.both;
    }
    case 'R9':
      return f.context.expectedLane === 1 ? LANE.left : LANE.right;
    default:
      return FIXED[f.ruleId];
  }
}

/** Every sentence the instructor can say (for pre-generating audio). */
export const everyTip = (): string[] => [PRACTICE_OPENING, ...Object.values(FIXED), ...Object.values(LOOK), ...Object.values(LANE)];
