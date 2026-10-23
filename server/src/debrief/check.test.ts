import { describe, expect, it } from 'vitest';
import { checkExplanation, checkSummary, MAX_SUMMARY_CHARS, MAX_TEXT_CHARS, type GuidanceChunk } from './check';
import { describeFault } from './describe';

const chunk = (id: string, ruleIds: string[]): GuidanceChunk => ({ _id: id, source: 'The Highway Code', url: `https://x/#${id}`, title: id, text: '…', ruleIds });

const fault = { _id: 'sess-1:2', ruleId: 'R9' as const };
const sessionFaults = new Set(['sess-1:1', 'sess-1:2']);
const given = new Set(['hc-186', 'hc-184', 'hc-187']);
const stored = new Map([
  ['hc-186', chunk('hc-186', ['R5', 'R6', 'R9'])],
  ['hc-184', chunk('hc-184', ['R3', 'R4', 'R5', 'R9'])],
  ['hc-187', chunk('hc-187', ['R11'])],
]);
const good = { faultId: 'sess-1:2', text: 'For the third exit you should approach in the right-hand lane.', guidanceChunkIds: ['hc-186', 'hc-184'] };
const check = (answer: unknown, s = stored) => checkExplanation(answer, fault, sessionFaults, given, s);
const problems = (answer: unknown, s = stored) => {
  const r = check(answer, s);
  return r.ok ? [] : r.problems;
};

describe('checkExplanation', () => {
  it('accepts an explanation of the right fault citing real chunks for its rule', () => {
    expect(check({ ...good, text: `  ${good.text}  ` })).toEqual({ ok: true, explanation: good });
  });

  it('rejects an answer about another fault, or a fault not in the session', () => {
    expect(problems({ ...good, faultId: 'sess-1:1' })).toEqual(['faultId must be "sess-1:2", the fault you were asked about']);
    expect(problems({ ...good, faultId: 'made-up' })).toHaveLength(1);
    const r = checkExplanation(good, fault, new Set(['sess-1:1']), given, stored);
    expect(r).toEqual({ ok: false, problems: ['fault "sess-1:2" is not in this test'] });
  });

  it('rejects a made-up chunk id', () => {
    expect(problems({ ...good, guidanceChunkIds: ['hc-999'] })).toEqual(['"hc-999" was not one of the guidance chunks you were given']);
  });

  it('rejects a chunk it was given that is not (or no longer) in guidance_chunks', () => {
    const gone = new Map([...stored].filter(([k]) => k !== 'hc-184'));
    expect(problems(good, gone)).toEqual(['"hc-184" is not a real guidance chunk']);
  });

  it('rejects a real chunk that is not about the fault’s rule', () => {
    expect(problems({ ...good, guidanceChunkIds: ['hc-186', 'hc-187'] })).toEqual(['"hc-187" is not about rule R9']);
  });

  it('rejects no citations, too many, repeats and non-strings', () => {
    expect(problems({ ...good, guidanceChunkIds: [] })).toEqual(['cite at least one guidance chunk id']);
    expect(problems({ ...good, guidanceChunkIds: undefined })).toEqual(['cite at least one guidance chunk id']);
    expect(problems({ ...good, guidanceChunkIds: ['hc-186', 'hc-184', 'hc-186', 'hc-184'] })).toEqual(['cite at most 3 guidance chunks']);
    expect(problems({ ...good, guidanceChunkIds: ['hc-186', 'hc-186'] })).toEqual(['do not cite the same chunk twice']);
    expect(problems({ ...good, guidanceChunkIds: [186] })).toEqual(['guidance chunk ids must be strings']);
  });

  it('rejects empty or overlong text', () => {
    expect(problems({ ...good, text: '   ' })).toEqual(['text is empty']);
    expect(problems({ ...good, text: 42 })).toEqual(['text is empty']);
    expect(problems({ ...good, text: 'x'.repeat(MAX_TEXT_CHARS + 1) })).toEqual([`text is ${MAX_TEXT_CHARS + 1} characters; keep it under ${MAX_TEXT_CHARS}`]);
  });

  it('rejects answers that are not JSON objects', () => {
    expect(problems('Here is your debrief…')).toEqual(['the answer was not a JSON object']);
    expect(problems(null)).toEqual(['the answer was not a JSON object']);
  });

  it('lists every problem at once, for the second try', () => {
    expect(problems({ faultId: 'x', text: '', guidanceChunkIds: ['hc-187'] })).toHaveLength(3);
  });
});

describe('checkSummary', () => {
  const rules = new Set(['R9', 'R4']);
  const summary = { text: 'Plan your lane early at roundabouts.', guidanceChunkIds: ['hc-186'] };
  it('accepts a summary citing chunks the explanations used, about the test’s rules', () => {
    expect(checkSummary(summary, rules, given, stored)).toEqual({ ok: true, summary });
  });
  it('rejects chunks it was not given, chunks about none of the test’s rules, and the usual text problems', () => {
    expect(checkSummary({ ...summary, guidanceChunkIds: ['hc-999'] }, rules, given, stored)).toEqual({
      ok: false,
      problems: ['"hc-999" was not one of the guidance chunks you were given'],
    });
    expect(checkSummary({ ...summary, guidanceChunkIds: ['hc-187'] }, rules, given, stored)).toEqual({
      ok: false,
      problems: ['"hc-187" is not about any fault in this test'],
    });
    const long = checkSummary({ ...summary, text: 'x'.repeat(MAX_SUMMARY_CHARS + 1) }, rules, given, stored);
    expect(long.ok).toBe(false);
    expect(checkSummary('nope', rules, given, stored)).toEqual({ ok: false, problems: ['the answer was not a JSON object'] });
  });
});

describe('describeFault', () => {
  const base = { _id: 'f', junctionId: 'j', speedMph: 43.4, category: 'serious' as const };
  it('puts the recorded facts in words', () => {
    expect(describeFault({ ...base, ruleId: 'R1', context: { limitMph: 30 } })).toBe('Speeding (serious fault): 43 mph in a 30 mph limit.');
    expect(describeFault({ ...base, category: 'driving', ruleId: 'R9', context: { action: 'roundabout', exit: 3, lane: 1, expectedLane: 2, lanes: 2 } })).toBe(
      'Roundabout lane (driving fault): approached in lane 1 of 2 (counting from the left) when taking the 3rd exit at a roundabout; the correct lane was lane 2.',
    );
    expect(describeFault({ ...base, category: 'driving', ruleId: 'R6', context: { action: 'left', expected: 'left', shown: 'right' } })).toBe(
      'Wrong signal (driving fault): signalled right instead of left when turning left at a junction.',
    );
    expect(describeFault({ ...base, category: 'dangerous', ruleId: 'R11', context: { with: 'parkedCar' } })).toBe(
      'Collision (dangerous fault): hit a parked car at 43 mph.',
    );
  });
});
