import { describe, expect, it } from 'vitest';
import { LIMIT_MS, offered, outcome, parseVerdict, step, tellMeFault, TELL_ME_JUNCTION, type FlowEvent, type FlowState, type TellMeQuestion } from './tell-me';

const question: TellMeQuestion = {
  id: 'tellme-8',
  topic: 'brake lights',
  question: 'Tell me how you’d check the brake lights are working on this car.',
  answer: 'Explain you’d operate the brake pedal, make use of reflections in windows or doors, or ask someone to help.',
};

/** Runs events in order, each `gap` ms after the last; returns the final state. */
function run(events: FlowEvent[], gap = 100, from: FlowState = offered(0)): FlowState {
  let s = from;
  let now = s.since;
  for (const e of events) s = step(s, e, (now += gap));
  return s;
}

const answered: FlowEvent[] = [
  { type: 'start' },
  { type: 'connected', question },
  { type: 'pressT' },
  { type: 'releaseT' },
  { type: 'verdict', verdict: { verdict: 'incorrect', reason: 'You missed using reflections.' } },
];

describe('parseVerdict', () => {
  it('takes a real verdict and tidies the reason', () => {
    expect(parseVerdict({ verdict: 'correct', reason: '  Good,\n  covered it. ' })).toEqual({ verdict: 'correct', reason: 'Good, covered it.' });
    expect(parseVerdict({ verdict: 'incorrect' })).toEqual({ verdict: 'incorrect', reason: '' });
    expect(parseVerdict({ verdict: 'correct', reason: 'x'.repeat(1000) })!.reason).toHaveLength(300);
  });

  it('treats anything else as no verdict', () => {
    for (const bad of [null, undefined, 'correct', {}, { verdict: 'pass' }, { verdict: 'Correct' }, { verdict: true }]) {
      expect(parseVerdict(bad)).toBeNull();
    }
  });
});

describe('tellMeFault', () => {
  it('makes a wrong answer one driving fault at the test centre', () => {
    const f = tellMeFault({ verdict: 'incorrect', reason: 'Missed reflections.', question }, 0.5, [10, -4]);
    expect(f).toEqual({
      ruleId: 'R15',
      category: 'driving',
      t: 0.5,
      pos: [10, -4],
      speedMph: 0,
      junctionId: TELL_ME_JUNCTION,
      context: { questionId: 'tellme-8', question: question.question, reason: 'Missed reflections.' },
    });
  });

  it('gives no fault for a right answer', () => {
    expect(tellMeFault({ verdict: 'correct', reason: '', question }, 0, [0, 0])).toBeNull();
  });
});

describe('the question, step by step', () => {
  it('goes from offered to a verdict, then done with the answer', () => {
    const phases: string[] = [];
    let s = offered(0);
    let now = 0;
    for (const e of [...answered, { type: 'dismiss' } as const]) {
      s = step(s, e, (now += 100));
      phases.push(s.phase);
    }
    expect(phases).toEqual(['connecting', 'asking', 'listening', 'judging', 'verdict', 'done']);
    expect(outcome(s)).toEqual({ verdict: 'incorrect', reason: 'You missed using reflections.', question });
  });

  it('waits on the offer for as long as it takes', () => {
    expect(step(offered(0), { type: 'tick' }, 10 * 60_000).phase).toBe('offered');
  });

  it('is skipped with no answer when the learner drives off, at any step before the verdict', () => {
    for (let n = 0; n < answered.length; n++) {
      const s = run([...answered.slice(0, n), { type: 'skip', why: 'KeyW pressed' }]);
      expect(s.phase).toBe('skipped');
      expect(outcome(s)).toBeNull();
    }
  });

  it('keeps the verdict when the learner drives off while it is showing', () => {
    const s = run([...answered, { type: 'skip', why: 'KeyW pressed' }]);
    expect(s.phase).toBe('done');
    expect(outcome(s)?.verdict).toBe('incorrect');
  });

  it.each([
    ['connecting', 1],
    ['asking', 2],
    ['judging', 4],
  ] as const)('is skipped when %s takes too long', (phase, n) => {
    const s = run(answered.slice(0, n));
    expect(s.phase).toBe(phase);
    expect(step(s, { type: 'tick' }, s.since + LIMIT_MS[phase] - 1).phase).toBe(phase);
    const late = step(s, { type: 'tick' }, s.since + LIMIT_MS[phase]);
    expect(late.phase).toBe('skipped');
    expect(late.why).toMatch(phase);
  });

  it('judges what was said when T is held too long', () => {
    const s = run(answered.slice(0, 3));
    expect(step(s, { type: 'tick' }, s.since + LIMIT_MS.listening).phase).toBe('judging');
  });

  it('closes the verdict by itself after a while', () => {
    const s = run(answered);
    expect(step(s, { type: 'tick' }, s.since + LIMIT_MS.verdict).phase).toBe('done');
  });

  it('lets the learner answer again when the examiner asks', () => {
    const s = run([...answered.slice(0, 4), { type: 'pressT' }]);
    expect(s.phase).toBe('listening');
  });

  it('ignores events that do not fit', () => {
    const s = offered(0);
    for (const e of [{ type: 'pressT' }, { type: 'releaseT' }, { type: 'dismiss' }, { type: 'connected', question }] as FlowEvent[]) {
      expect(step(s, e, 100)).toBe(s);
    }
    const done = run([...answered, { type: 'dismiss' }]);
    expect(step(done, { type: 'start' }, 99_999)).toBe(done);
  });

  it('has no answer if the model gives none', () => {
    expect(outcome(run([{ type: 'start' }, { type: 'skip', why: 'Live closed' }]))).toBeNull();
  });
});
