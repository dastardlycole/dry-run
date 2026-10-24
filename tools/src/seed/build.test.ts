import { describe, expect, it } from 'vitest';
import route from '../../../assets/wanstead/route-demo.json';
import { CENTRE } from '../../../client/src/config';
import { countFaults, drivingFaultLimit, resultOf } from '../../../client/src/faults/result';
import { makeProjection } from '../../../client/src/world/projection';
import type { Route } from '../../../client/src/world/types';
import { RULE_IDS } from '../../../server/src/sessions';
import { buildSeed, DEFAULT_SESSIONS, SIM_PREFIX } from './build';

const opts = { centreId: 'wanstead', now: new Date('2026-10-24T12:00:00Z'), toLatLng: makeProjection(CENTRE.lat, CENTRE.lng).toLatLng };
const seed = buildSeed(route as Route, opts);
const junctionIds = new Set((route as Route).steps.map((s) => s.junctionId));

describe('seed-demo data', () => {
  it('makes the default number of tests on the demo route, all ended and none abandoned', () => {
    expect(seed.sessions).toHaveLength(DEFAULT_SESSIONS);
    for (const s of seed.sessions) {
      expect(s).toMatchObject({ centreId: 'wanstead', routeId: 'demo', simulated: true });
      expect(s.abandoned).toBeUndefined();
      expect(s.endedAt!.getTime()).toBeGreaterThan(s.startedAt.getTime());
      expect(s.startedAt.getTime()).toBeLessThan(opts.now.getTime());
    }
  });

  it('marks every doc as simulated, with "sim-" ids', () => {
    for (const d of [...seed.learners, ...seed.sessions, ...seed.events]) {
      expect(d.simulated).toBe(true);
      expect(d._id.startsWith(SIM_PREFIX)).toBe(true);
    }
    for (const e of seed.events) expect(e.context.simulated).toBe(true);
  });

  it('every fault belongs to a seeded test and learner, at a route junction, near Wanstead', () => {
    const sessions = new Map(seed.sessions.map((s) => [s._id, s]));
    const learners = new Set(seed.learners.map((l) => l._id));
    for (const e of seed.events) {
      const s = sessions.get(e.sessionId)!;
      expect(s).toBeDefined();
      expect(e.learnerId).toBe(s.learnerId);
      expect(learners.has(e.learnerId)).toBe(true);
      expect(junctionIds.has(e.junctionId)).toBe(true);
      expect(RULE_IDS).toContain(e.ruleId);
      expect(e._id).toMatch(new RegExp(`^${e.sessionId}:\\d+$`));
      expect(e.ts.getTime()).toBeGreaterThanOrEqual(s.startedAt.getTime());
      expect(e.ts.getTime()).toBeLessThanOrEqual(s.endedAt!.getTime());
      const [lng, lat] = e.location.coordinates;
      expect(Math.abs(lat - CENTRE.lat)).toBeLessThan(0.02);
      expect(Math.abs(lng - CENTRE.lng)).toBeLessThan(0.03);
    }
    expect(new Set(seed.events.map((e) => e._id)).size).toBe(seed.events.length);
  });

  it('each test’s counts and result come from its own faults, the way the sim works them out', () => {
    for (const s of seed.sessions) {
      const counts = countFaults(seed.events.filter((e) => e.sessionId === s._id));
      expect(s.counts).toEqual(counts);
      expect(s.result).toBe(resultOf(counts, true, drivingFaultLimit(s.routeLengthM)));
    }
  });

  it('looks like a real test centre: a believable pass rate, and faults at most route junctions', () => {
    const passes = seed.sessions.filter((s) => s.result === 'PASS').length / seed.sessions.length;
    expect(passes).toBeGreaterThan(0.3);
    expect(passes).toBeLessThan(0.6);
    expect(new Set(seed.events.map((e) => e.junctionId)).size).toBeGreaterThanOrEqual(junctionIds.size - 1);
  });

  it('is the same every time for the same seed, and different for another', () => {
    expect(buildSeed(route as Route, opts)).toEqual(seed);
    expect(buildSeed(route as Route, { ...opts, seed: 2 }).events).not.toEqual(seed.events);
  });
});
