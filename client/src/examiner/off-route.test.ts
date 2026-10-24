import { describe, expect, it } from 'vitest';
import { everyPhrase, OFF_ROUTE_LINE, REROUTE_LINE } from './phrases';
import { BACK_ON_S, LastOnRoute, OFF_ROUTE_S, OffRoute, SETTLE_S } from './off-route';

const FAR = 40;

describe('OffRoute', () => {
  it('says so once the car has been off the route for a few seconds', () => {
    const o = new OffRoute();
    expect(o.update(0, FAR)).toBe(false);
    expect(o.update(OFF_ROUTE_S - 0.1, FAR)).toBe(false);
    expect(o.update(OFF_ROUTE_S, FAR)).toBe(true);
    // Once per trip off the route.
    expect(o.update(OFF_ROUTE_S + 10, FAR)).toBe(false);
  });

  it("doesn't count a moment off the line (a wide turn)", () => {
    const o = new OffRoute();
    o.update(0, FAR);
    o.update(1, 0);
    expect(o.update(OFF_ROUTE_S, FAR)).toBe(false);
  });

  it('can say it again only after being back on the route for a while', () => {
    const o = new OffRoute();
    o.update(0, FAR);
    o.update(OFF_ROUTE_S, FAR);
    o.update(10, 0);
    o.update(11, FAR);
    expect(o.update(11 + OFF_ROUTE_S, FAR)).toBe(false);
    o.update(20, 0);
    o.update(20 + BACK_ON_S, 0);
    o.update(30, FAR);
    expect(o.update(30 + OFF_ROUTE_S, FAR)).toBe(true);
  });

  it('has its Gemini audio made with the rest', () => {
    expect(everyPhrase()).toContain(REROUTE_LINE);
    expect(everyPhrase()).toContain(OFF_ROUTE_LINE);
  });
});

describe('LastOnRoute', () => {
  it('follows the car along the route, not while it is off it', () => {
    const l = new LastOnRoute();
    for (let i = 0; i <= 100; i++) l.update(i / 10, i * 3, 0.5);
    expect(l.m).toBe(300);
    l.update(11, 305, FAR);
    expect(l.m).toBe(300);
  });

  it("doesn't jump to another leg of a loop that passes near", () => {
    const l = new LastOnRoute();
    l.set(300);
    l.update(10, 2400, 10);
    l.update(10 + SETTLE_S + 1, 2400, 10);
    expect(l.m).toBe(300);
  });

  it('takes the new place once the car has really stayed on the route there', () => {
    const l = new LastOnRoute();
    l.set(300);
    l.update(10, 900, 2);
    expect(l.m).toBe(300);
    l.update(10 + SETTLE_S, 900, 2);
    expect(l.m).toBe(900);
  });
});
