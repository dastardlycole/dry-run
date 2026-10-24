import { describe, expect, it } from 'vitest';
import { summaryPrompt } from './argon';

// What the examiner's summary is told about how the test ended.

const ask = (result: 'PASS' | 'FAIL' | 'UNFINISHED', serious = 0) =>
  summaryPrompt({ result, counts: { driving: 1, serious, dangerous: 0 }, faults: [], chunks: [] });

describe('summaryPrompt', () => {
  it('tells it a test ended early has no pass or fail', () => {
    expect(ask('UNFINISHED')).toContain('never say they passed or failed');
    expect(ask('UNFINISHED')).not.toContain('would have been a fail');
  });

  it('says when the faults so far would already be a fail', () => {
    expect(ask('UNFINISHED', 1)).toContain("'this would have been a fail'");
  });

  it('tells it a practice drive has no result at all', () => {
    const prompt = summaryPrompt({ result: 'UNFINISHED', practice: true, counts: { driving: 1, serious: 1, dangerous: 0 }, faults: [], chunks: [] });
    expect(prompt).toContain('practice drive with an instructor, not a test');
    expect(prompt).not.toContain('Result:');
    expect(prompt).not.toContain('would have been a fail');
  });

  it('says nothing extra for a finished test', () => {
    expect(ask('PASS')).not.toContain('ended the test before');
  });
});
