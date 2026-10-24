import { describe, expect, it } from 'vitest';
import manifest from '../../../assets/audio/manifest.json';
import { RULE_NAMES, type RuleId } from '../faults/types';
import { everyPhrase } from './phrases';
import { everyTip, PRACTICE_OPENING, tipFor } from './tips';

const rules = Object.keys(RULE_NAMES) as RuleId[];

describe('tipFor', () => {
  it('has a tip for every rule, and every tip is one the instructor has audio for', () => {
    const tips = new Set(everyTip());
    for (const ruleId of rules) {
      const tip = tipFor({ ruleId, context: {} });
      expect(tip, ruleId).toBeTruthy();
      expect(tips).toContain(tip);
    }
  });

  it('says which way to look at a junction (R7)', () => {
    expect(tipFor({ ruleId: 'R7', context: { action: 'left', missed: ['right'] } })).toBe('Look right before you pull out here.');
    expect(tipFor({ ruleId: 'R7', context: { action: 'right', missed: ['left'] } })).toBe('Look left before you pull out here.');
    expect(tipFor({ ruleId: 'R7', context: { action: 'left', missed: ['left', 'right'] } })).toBe('Look both ways before you pull out here.');
    expect(tipFor({ ruleId: 'R7', context: { action: 'roundabout', missed: ['right'] } })).toBe('Look right before you join the roundabout.');
  });

  it('says which lane to use (R9)', () => {
    expect(tipFor({ ruleId: 'R9', context: { expectedLane: 1, lanes: 2 } })).toBe('Use the left lane for this exit.');
    expect(tipFor({ ruleId: 'R9', context: { expectedLane: 2, lanes: 2 } })).toBe('Use the right lane for this exit.');
  });
});

describe('everyTip', () => {
  it('is part of the sentences the Gemini audio is made from, so the voice never changes', () => {
    const all = new Set(everyPhrase());
    for (const tip of everyTip()) expect(all).toContain(tip);
    expect(everyTip()).toContain(PRACTICE_OPENING);
  });

  it('has its audio made (npm run gen-tts -w tools)', () => {
    for (const tip of everyTip()) expect(Object.keys(manifest), tip).toContain(tip);
  });

  it('never says a road name or a result', () => {
    for (const tip of everyTip()) expect(tip).not.toMatch(/pass|fail|Road|Street|Lane\b/);
  });
});
