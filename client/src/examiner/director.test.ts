import { describe, expect, it } from 'vitest';
import route from '../../../assets/wanstead/route-demo.json';
import { MPH_PER_MS } from '../sim/controls';
import type { Route } from '../world/types';
import { Director, LEAD_S, speechSeconds } from './director';
import { OPENING, routeDirections } from './phrases';

const directions = routeDirections(route as Route);
const DT = 1 / 30;

/** Drives the whole route at a steady speed; returns when each sentence started and where. */
function driveAt(mph: number) {
  const v = mph / MPH_PER_MS;
  const director = new Director(directions);
  const said: { text: string; m: number }[] = [];
  for (let m = 0; m <= (route as Route).lengthM; m += v * DT) {
    for (const text of director.update(m, v)) said.push({ text, m });
  }
  return { said, v };
}

describe('Director', () => {
  it('says the opening first, then every direction once, in order', () => {
    const { said } = driveAt(30);
    expect(said.map((s) => s.text)).toEqual([OPENING, ...directions.map((d) => d.text)]);
  });

  for (const mph of [10, 20, 30, 40]) {
    it(`finishes each direction at least ${LEAD_S} s before the manoeuvre at ${mph} mph`, () => {
      const { said, v } = driveAt(mph);
      // The first one is given at the start, while parked (see the next test).
      for (const d of directions.slice(1)) {
        const s = said.find((x) => x.text === d.text)!;
        const secondsLeft = (d.atM - s.m) / v - speechSeconds(d.text);
        expect(secondsLeft, d.text).toBeGreaterThanOrEqual(LEAD_S - DT);
      }
    });
  }

  it('gives a nearby first direction with the opening, before the car moves', () => {
    const d = new Director(directions);
    expect(d.update(0, 0)).toEqual([OPENING, 'At the lights, turn left onto High Street.']);
  });

  it("doesn't give the next direction until the car is past the last manoeuvre", () => {
    const { said } = driveAt(40);
    for (let i = 1; i < directions.length; i++) {
      const s = said.find((x) => x.text === directions[i].text)!;
      expect(s.m).toBeGreaterThan(directions[i - 1].endM);
    }
  });

  it('waits while the car is stopped far from the next junction', () => {
    const d = new Director([{ stepId: 'a', atM: 300, endM: 300, text: 'Take the next road on the left.' }]);
    expect(d.update(0, 0)).toEqual([OPENING]);
    expect(d.update(100, 0)).toEqual([]);
    expect(d.update(265, 0)).toEqual(['Take the next road on the left.']);
  });

  it('starts over after a reset, and skips directions the car has already passed', () => {
    const d = new Director(directions);
    d.update(0, 10);
    d.reset();
    expect(d.update(0, 0)).toEqual([OPENING, directions[0].text]);
    // Jumped past the first manoeuvres: the right turn into Spratt Hall Road is next.
    expect(d.update(1000, 10)).toEqual(['Take the next road on the right onto Spratt Hall Road.']);
  });

  it('still gives skipped directions if the car turns out not to have passed them', () => {
    const d = new Director(directions);
    d.update(0, 0);
    // The car's place on the route wrongly jumps to near the end, then comes back.
    expect(d.update(1950, 10)).toEqual(["Pull up on the left when it's safe."]);
    expect(d.update(600, 10)).toEqual([directions[1].text]);
  });
});
