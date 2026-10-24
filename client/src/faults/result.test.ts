import { describe, expect, it } from 'vitest';
import { countFaults, drivingFaultLimit, resultOf, wouldFail } from './result';

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

describe('drivingFaultLimit', () => {
  it('scales the 15 driving faults to the length of the drive', () => {
    expect(drivingFaultLimit(12_000)).toBe(15);
    expect(drivingFaultLimit(3_000)).toBe(4);
    expect(drivingFaultLimit(1_988)).toBe(3);
    expect(drivingFaultLimit(4_440)).toBe(6);
    expect(drivingFaultLimit(100)).toBe(1);
  });

  it('never allows more than the real test, and an unknown length gets the real 15', () => {
    expect(drivingFaultLimit(30_000)).toBe(15);
    expect(drivingFaultLimit(undefined)).toBe(15);
    expect(drivingFaultLimit(0)).toBe(15);
  });

  it('a 3 km route passes with 4 driving faults and fails with 5', () => {
    const limit = drivingFaultLimit(3_000);
    expect(resultOf(counts(4), true, limit)).toBe('PASS');
    expect(resultOf(counts(5), true, limit)).toBe('FAIL');
    expect(resultOf(counts(0, 1), true, limit)).toBe('FAIL');
    expect(wouldFail(counts(5), limit)).toBe(true);
  });
});
