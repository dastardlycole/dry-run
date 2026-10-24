import { describe, expect, it } from 'vitest';
import { countFaults, resultOf, wouldFail } from './result';

const counts = (driving = 0, serious = 0, dangerous = 0) => ({ driving, serious, dangerous });

describe('resultOf', () => {
  it('a finished drive passes or fails on its faults, as before', () => {
    expect(resultOf(counts())).toBe('PASS');
    expect(resultOf(counts(15))).toBe('PASS');
    expect(resultOf(counts(16))).toBe('FAIL');
    expect(resultOf(counts(0, 1))).toBe('FAIL');
    expect(resultOf(counts(0, 0, 1), true)).toBe('FAIL');
  });

  it('ending before the end of the route is never a pass, even with no faults', () => {
    expect(resultOf(counts(), false)).toBe('UNFINISHED');
    expect(resultOf(counts(3), false)).toBe('UNFINISHED');
    expect(resultOf(counts(0, 1), false)).toBe('UNFINISHED');
  });

  it('still says whether an unfinished test would have failed', () => {
    expect(wouldFail(counts(3))).toBe(false);
    expect(wouldFail(countFaults([{ category: 'serious' }]))).toBe(true);
  });
});
