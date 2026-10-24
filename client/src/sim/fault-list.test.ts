import { describe, expect, it } from 'vitest';
import { junctionLine } from './fault-list';

const facts = { name: 'x', sessionsThrough: 25, simulatedThrough: 24, sessionsWithFault: 9, collisions: 14, collisionsSince: '2020-01-04T00:00:00.000Z' };

describe('junctionLine', () => {
  it('says how many of the tests were simulated', () => {
    expect(junctionLine(facts)).toBe('9 of 25 tests here had a fault (24 simulated) · 14 reported collisions here since 2020');
  });

  it('says nothing about simulated tests when there are none', () => {
    expect(junctionLine({ ...facts, sessionsThrough: 5, simulatedThrough: 0, sessionsWithFault: 2, collisions: 0 })).toBe('2 of 5 tests here had a fault');
  });

  it('hides the rate under 3 tests', () => {
    expect(junctionLine({ ...facts, sessionsThrough: 2, simulatedThrough: 0, collisions: 0 })).toBe('');
  });
});
