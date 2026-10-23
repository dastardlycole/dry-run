import { describe, expect, it } from 'vitest';
import { PullUp, STOPPED_S } from './pullup';

describe('PullUp', () => {
  const END = 2000;
  /** Feeds `seconds` of frames at 30 fps; true if the drive ended. */
  const hold = (p: PullUp, from: number, seconds: number, routeM: number, mph: number, asked = true) => {
    let ended = false;
    for (let t = from; t < from + seconds; t += 1 / 30) ended = p.update(t, routeM, mph, asked) || ended;
    return ended;
  };

  it(`ends the drive once the car has stood still for ${STOPPED_S} s after being asked to pull up`, () => {
    const p = new PullUp(END);
    expect(hold(p, 0, 0.5, 1950, 0)).toBe(false);
    expect(hold(p, 0.5, 1, 1950, 0)).toBe(true);
  });

  it('keeps going while the car is moving, or before it is asked', () => {
    expect(hold(new PullUp(END), 0, 3, 1950, 8)).toBe(false);
    expect(hold(new PullUp(END), 0, 3, 1950, 0, false)).toBe(false);
  });

  it("doesn't end at a stop far from the end of the route", () => {
    expect(hold(new PullUp(END), 0, 3, 900, 0)).toBe(false);
  });

  it('starts the count again if the car creeps forward', () => {
    const p = new PullUp(END);
    hold(p, 0, 0.8, 1950, 0);
    hold(p, 0.8, 0.1, 1950, 3);
    expect(hold(p, 0.9, 0.8, 1950, 0)).toBe(false);
  });
});
