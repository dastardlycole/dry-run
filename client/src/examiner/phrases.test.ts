import { describe, expect, it } from 'vitest';
import route from '../../../assets/wanstead/route-demo.json';
import type { Route, RouteStep } from '../world/types';
import { END_FAIL, END_PASS, END_UNFINISHED, everyPhrase, OPENING, phraseFor, routeDirections, sentencesOf } from './phrases';

const step = (s: Partial<RouteStep>): RouteStep => ({
  id: 's',
  junctionId: 'j',
  pos: [0, 0],
  atM: 100,
  action: 'left',
  turnDeg: 90,
  control: 'none',
  approachEdgeId: 'a',
  exitEdgeId: 'b',
  fromRoad: 'Old Road',
  toRoad: 'New Road',
  ...s,
});

describe('phraseFor', () => {
  it("doesn't say road names, so every sentence is one of a fixed set", () => {
    expect(phraseFor(step({ control: 'signals' }))).toBe('At the lights, turn left.');
    expect(phraseFor(step({ control: 'giveway', action: 'right' }))).toBe('At the end of the road, turn right.');
    expect(phraseFor(step({ control: 'stop' }))).toBe('At the end of the road, turn left.');
    expect(phraseFor(step({ action: 'right' }))).toBe('Take the next road on the right.');
  });

  it('gives the roundabout exit as a word', () => {
    expect(phraseFor(step({ action: 'roundabout', control: 'roundabout', exit: 3, exits: 3, toRoad: 'A1008' }))).toBe(
      'At the roundabout, take the third exit.',
    );
    expect(phraseFor(step({ action: 'roundabout', exit: 1, toRoad: 'New Road' }))).toBe('At the roundabout, take the first exit.');
  });

  it('says nothing for straight on, and asks to pull up at the end', () => {
    expect(phraseFor(step({ action: 'ahead' }))).toBeNull();
    expect(phraseFor(step({ action: 'end' }))).toBe("Pull up on the left when it's safe.");
  });
});

describe('demo route directions', () => {
  it('matches what an examiner would say on the Wanstead route', () => {
    expect(routeDirections(route as Route).map((d) => d.text)).toEqual([
      'At the lights, turn left.',
      // The roundabout is only 69 m after these lights.
      'At the lights, turn left. Then at the roundabout, take the third exit.',
      'Take the next road on the right.',
      'At the end of the road, turn right.',
      "Pull up on the left when it's safe.",
    ]);
  });

  it('joins at most two close manoeuvres into one sentence', () => {
    const steps = [
      step({ id: 'a', atM: 100, control: 'signals', toRoad: 'A1' }),
      step({ id: 'b', atM: 150, action: 'right', toRoad: 'A1' }),
      step({ id: 'c', atM: 200, action: 'left', toRoad: 'A1' }),
    ];
    expect(routeDirections({ steps })).toEqual([
      { stepId: 'a', atM: 100, endM: 150, text: 'At the lights, turn left. Then take the next road on the right.' },
      { stepId: 'c', atM: 200, endM: 200, text: 'Take the next road on the left.' },
    ]);
  });

  it('lists every sentence once, opening first', () => {
    const all = everyPhrase();
    expect(all[0]).toBe(OPENING);
    expect(new Set(all).size).toBe(all.length);
  });

  it('has audio for every sentence of the demo route, and both spoken results', () => {
    const all = new Set(everyPhrase());
    for (const d of routeDirections(route as Route)) for (const s of sentencesOf(d.text)) expect(all).toContain(s);
    expect([...all]).toEqual(expect.arrayContaining([END_PASS, END_FAIL, END_UNFINISHED]));
  });

  it('splits a joined direction into its two sentences', () => {
    expect(sentencesOf('At the lights, turn left. Then take the next road on the right.')).toEqual([
      'At the lights, turn left.',
      'Then take the next road on the right.',
    ]);
    expect(sentencesOf('At the lights, turn left.')).toEqual(['At the lights, turn left.']);
  });
});
