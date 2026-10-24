import { describe, expect, it } from 'vitest';
import { everyPhrase, OFF_ROUTE_LINE } from './phrases';
import { BACK_ON_S, OFF_ROUTE_S, OffRoute } from './off-route';

const FAR = 40;

describe('OffRoute', () => {
  it('says so once the car has been off the route for a few seconds', () => {
    const o = new OffRoute();
    expect(o.update(0, FAR)).toBeNull();
    expect(o.update(OFF_ROUTE_S - 0.1, FAR)).toBeNull();
    expect(o.update(OFF_ROUTE_S, FAR)).toBe(OFF_ROUTE_LINE);
    // Once per trip off the route.
    expect(o.update(OFF_ROUTE_S + 10, FAR)).toBeNull();
  });

  it("doesn't count a moment off the line (a wide turn)", () => {
    const o = new OffRoute();
    o.update(0, FAR);
    o.update(1, 0);
    expect(o.update(OFF_ROUTE_S, FAR)).toBeNull();
  });

  it('can say it again only after being back on the route for a while', () => {
    const o = new OffRoute();
    o.update(0, FAR);
    o.update(OFF_ROUTE_S, FAR);
    o.update(10, 0);
    o.update(11, FAR);
    expect(o.update(11 + OFF_ROUTE_S, FAR)).toBeNull();
    o.update(20, 0);
    o.update(20 + BACK_ON_S, 0);
    o.update(30, FAR);
    expect(o.update(30 + OFF_ROUTE_S, FAR)).toBe(OFF_ROUTE_LINE);
  });

  it('has its Gemini audio made with the rest', () => {
    expect(everyPhrase()).toContain(OFF_ROUTE_LINE);
  });
});
