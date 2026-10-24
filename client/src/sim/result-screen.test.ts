import { describe, expect, it } from 'vitest';
import { resultHeading } from './result-screen';

describe('resultHeading', () => {
  it('never shows a pass or fail for a practice drive', () => {
    expect(resultHeading(null)).toEqual(['practice', 'Practice drive']);
    expect(resultHeading(null).join(' ')).not.toMatch(/pass|fail|test/i);
  });

  it('shows the result of a mock test', () => {
    expect(resultHeading('PASS')[1]).toBe('Pass');
    expect(resultHeading('FAIL')[1]).toBe('Fail');
    expect(resultHeading('UNFINISHED')[1]).toBe('Test not finished');
  });
});
