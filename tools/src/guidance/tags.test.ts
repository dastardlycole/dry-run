import { describe, expect, it } from 'vitest';
import { tagRule } from './tags';

describe('tagRule', () => {
  it('tags a rule by what it talks about', () => {
    expect(tagRule('Approach these in the same way as normal roundabouts. Signal your exit.')).toEqual(['R5', 'R6']);
    expect(tagRule('When going right at a roundabout, use the right-hand lane.')).toEqual(['R9']);
    expect(tagRule('You MUST stop behind the white stop line across your side of the road unless the traffic lights are green.')).toEqual(['R2']);
    expect(tagRule('Give way to traffic from the right.')).toEqual(['R11']);
  });

  it('needs every part: mirrors alone are not a mirror check at a junction', () => {
    expect(tagRule('Keep your mirrors clean.')).toEqual([]);
    expect(tagRule('Use your mirrors before turning into the junction.')).toEqual(['R4']);
  });

  it('leaves out rules about things a learner never does on our route', () => {
    expect(tagRule('Do not overtake when approaching a junction or roundabout; check mirrors and signal.')).toEqual([]);
    expect(tagRule('Skids are usually caused by driving too fast.')).toEqual([]);
  });
});
