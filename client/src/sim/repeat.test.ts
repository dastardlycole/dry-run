import { describe, expect, it } from 'vitest';
import { REPEAT_BACK_M, repeatFromM } from './repeat';

const steps = [
  { action: 'left' as const, atM: 300 },
  { action: 'roundabout' as const, atM: 700, line: { atM: 680, kind: 'giveway' as const } },
  { action: 'end' as const, atM: 1200 },
];

describe('repeatFromM', () => {
  it('goes back before the last junction passed', () => {
    expect(repeatFromM(steps, 500)).toBe(300 - REPEAT_BACK_M);
    // A roundabout is judged at its give-way line.
    expect(repeatFromM(steps, 900)).toBe(680 - REPEAT_BACK_M);
  });

  it('has nothing to repeat before the first junction, and never goes before the start', () => {
    expect(repeatFromM(steps, 200)).toBeNull();
    expect(repeatFromM([{ action: 'right', atM: 40 }], 100)).toBe(0);
  });

  it("doesn't count the end of the route as a junction", () => {
    expect(repeatFromM(steps, 1300)).toBe(680 - REPEAT_BACK_M);
  });
});
