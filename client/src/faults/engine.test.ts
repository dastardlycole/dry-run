import { describe, expect, it } from 'vitest';
import demo from '../../../assets/wanstead/route-demo.json';
import type { Light } from '../world/lights';
import type { Route, RouteStep } from '../world/types';
import { runTrace, toFaultEvent } from './engine';
import { speedLimitAt } from './limits';
import { makeProjection } from '../world/projection';
import { expectedSignal } from './rules';
import { carefulControls, drive } from './trace';
import type { FaultContext, Frame } from './types';

// Rules R1–R6 on scripted drives along the real Wanstead demo route (SPEC §4.6 FR-F5).

const route = demo as Route;
const step = (id: string) => route.steps.find((s) => s.id === id)!;
const MPH = 25;
const careful = carefulControls(route, MPH);

const ctx = (lightFor: FaultContext['lightFor'] = () => 'green'): FaultContext => ({
  steps: route.steps,
  lightFor,
  junctions: route.steps.map((s) => ({ id: s.junctionId, pos: s.pos })),
});

/** A careful drive, with some controls changed between two points on the route. */
const withChange =
  (fromM: number, toM: number, change: (c: ReturnType<typeof careful>) => Partial<Frame>) => (m: number) =>
    m >= fromM && m <= toM ? { ...careful(m), ...change(careful(m)) } : careful(m);

const rules = (frames: Frame[], c = ctx()) => runTrace(c, frames).map((f) => `${f.ruleId}:${f.category}:${f.junctionId}`);

describe('a careful drive', () => {
  it('gets no faults over the whole route', () => {
    expect(runTrace(ctx(), drive(route, { mph: MPH, controls: careful }))).toEqual([]);
  });

  it('gives the same faults every time for the same drive', () => {
    const frames = drive(route, { mph: MPH + 8, controls: () => ({ indicator: 'left' }) });
    const a = runTrace(ctx(), frames);
    expect(a.length).toBeGreaterThan(0);
    expect(runTrace(ctx(), frames)).toEqual(a);
  });
});

describe('R1 speeding', () => {
  const at = (mph: number, seconds: number) =>
    rules(drive(route, { fromM: 300, toM: 300 + (seconds * mph) / 2.23694, mph, limitMph: 30 }));

  it('allows up to 2 mph over, and short bursts', () => {
    expect(at(32, 5)).toEqual([]);
    expect(at(34, 1.5)).toEqual([]);
  });

  it('marks over limit + 2 for more than 2 s as a driving fault', () => {
    expect(at(34, 3)).toEqual([expect.stringMatching(/^R1:driving:/)]);
  });

  it('marks over limit + 10 for more than 2 s as serious too', () => {
    expect(at(42, 3)).toEqual([expect.stringMatching(/^R1:driving:/), expect.stringMatching(/^R1:serious:/)]);
  });

  it('marks each spell of speeding once', () => {
    const frames = drive(route, { fromM: 300, toM: 500, limitMph: 30, mph: (m) => (m < 360 || m > 420 ? 36 : 25) });
    expect(rules(frames)).toEqual([expect.stringMatching(/^R1:driving:/), expect.stringMatching(/^R1:driving:/)]);
  });

  it("uses the road's limit, and 30 mph off the mapped roads", () => {
    const edge = { points: [[0, 0], [100, 0]] as [number, number][], maxspeedMph: 20 };
    expect(speedLimitAt([50, 3], [edge])).toBe(20);
    expect(speedLimitAt([50, 40], [edge])).toBe(30);
    expect(speedLimitAt([50, 3], [{ ...edge, maxspeedMph: 0 }])).toBe(30);
  });
});

describe('R2 red light', () => {
  const s1 = step('s1');
  const lightAtS1 = (light: Light) => (edgeId: string) => (edgeId === s1.approachEdgeId ? light : 'green');

  it('marks crossing the stop line on red, or red and amber, as dangerous', () => {
    const frames = drive(route, { toM: 100, mph: MPH, controls: careful });
    expect(rules(frames, ctx(lightAtS1('red')))).toEqual([`R2:dangerous:${s1.junctionId}`]);
    expect(rules(frames, ctx(lightAtS1('redAmber')))).toEqual([`R2:dangerous:${s1.junctionId}`]);
  });

  it('allows green and amber', () => {
    const frames = drive(route, { toM: 100, mph: MPH, controls: careful });
    expect(rules(frames, ctx(lightAtS1('green')))).toEqual([]);
    expect(rules(frames, ctx(lightAtS1('amber')))).toEqual([]);
  });

  it('allows waiting at a red light, and a reset that jumps past the line', () => {
    const approach = drive(route, { toM: s1.line!.atM - 2, mph: MPH, controls: careful });
    const last = approach[approach.length - 1];
    const stopped = Array.from({ length: 300 }, (_, i) => ({ ...last, t: last.t + (i + 1) / 30, speedMph: 0 }));
    const waiting = [...approach, ...stopped];
    expect(rules(waiting, ctx(lightAtS1('red')))).toEqual([]);
    const jump: Frame[] = [
      { ...waiting[0], routeM: 10 },
      { ...waiting[0], t: 0.1, routeM: 90 },
    ];
    expect(rules(jump, ctx(lightAtS1('red')))).toEqual([]);
  });
});

describe('R3 mirror before signal', () => {
  it('marks signalling with no mirror check in the 3 s before', () => {
    const frames = drive(route, { fromM: 200, toM: 260, mph: MPH, controls: (m) => ({ indicator: m > 230 ? 'right' : 'off' }) });
    expect(rules(frames)).toEqual([expect.stringMatching(/^R3:driving:/)]);
  });

  it('allows a signal after a mirror check, and marks switching sides without one', () => {
    const frames = drive(route, {
      fromM: 200,
      toM: 400,
      mph: MPH,
      controls: (m) => ({ mirror: m > 220 && m < 225, indicator: m > 230 ? (m > 350 ? 'left' : 'right') : 'off' }),
    });
    expect(rules(frames)).toEqual([expect.stringMatching(/^R3:driving:/)]);
    expect(runTrace(ctx(), frames)[0].context).toEqual({ indicator: 'left' });
  });
});

describe('R4 mirror before turn', () => {
  const s6 = step('s6');

  it('marks a turn with no mirror check in the 5 s before', () => {
    // Mirror only before signalling, ~8 s before the turn at this speed.
    const controls = withChange(s6.atM - 60, s6.atM, () => ({ mirror: false }));
    expect(rules(drive(route, { mph: MPH, controls }))).toEqual([`R4:driving:${s6.junctionId}`]);
  });

  it('judges a roundabout at its give-way line', () => {
    const s4 = step('s4');
    const controls = withChange(s4.line!.atM - 40, s4.line!.atM, () => ({ mirror: false }));
    const faults = runTrace(ctx(), drive(route, { mph: MPH, controls }));
    expect(faults.map((f) => f.ruleId)).toEqual(['R4']);
    expect(faults[0].context).toMatchObject({ stepId: 's4', action: 'roundabout', exit: 3 });
  });
});

describe('R5 no signal before turn', () => {
  const s7 = step('s7');

  it('marks a turn with no signal', () => {
    const controls = withChange(s7.atM - 100, s7.atM + 10, () => ({ indicator: 'off' }));
    expect(rules(drive(route, { mph: MPH, controls }))).toEqual([`R5:driving:${s7.junctionId}`]);
  });

  it('marks a signal cancelled more than 3 s before the turn', () => {
    const v = MPH / 2.23694;
    const controls = withChange(s7.atM - 4 * v, s7.atM + 10, () => ({ indicator: 'off' }));
    expect(rules(drive(route, { mph: MPH, controls }))).toEqual([`R5:driving:${s7.junctionId}`]);
  });

  it('needs a right signal for the third exit of three at the roundabout', () => {
    expect(expectedSignal(step('s4'))).toBe('right');
    const rb = (exit: number, exits: number) => expectedSignal({ ...step('s4'), exit, exits } as RouteStep);
    expect(rb(1, 3)).toBe('left');
    expect(rb(2, 3)).toBe('off');
    expect(rb(2, 4)).toBe('off');
    expect(rb(3, 4)).toBe('right');
  });
});

describe('R6 wrong signal', () => {
  const s6 = step('s6');

  it('marks the wrong indicator, and not also as no signal', () => {
    const controls = withChange(s6.atM - 80, s6.atM + 5, (c) => ({ indicator: c.indicator === 'right' ? 'left' : c.indicator }));
    expect(rules(drive(route, { mph: MPH, controls }))).toEqual([`R6:driving:${s6.junctionId}`]);
  });

  it("isn't fooled by an early signal for the next turn when passing straight-on lights", () => {
    // s2 is straight on at lights, 40 m before the left at s3: signalling left through s2 is fine.
    expect(step('s2').action).toBe('ahead');
    const controls = withChange(step('s2').atM - 20, step('s3').atM, () => ({ indicator: 'left' }));
    expect(rules(drive(route, { mph: MPH, controls }))).toEqual([]);
  });

  it("allows the last turn's signal still on as the car reaches a roundabout just after it", () => {
    // At 40 mph the roundabout's give-way line is under 3 s after the left at s3.
    const fast = carefulControls(route, 40);
    const s3 = step('s3');
    const controls = (m: number) => (m > s3.atM && m < s3.atM + 15 ? { ...fast(m), indicator: 'left' as const } : fast(m));
    expect(rules(drive(route, { mph: 40, limitMph: 40, controls }))).toEqual([]);
  });

  it("doesn't judge a turn the car didn't take (off the route)", () => {
    const controls = withChange(s6.atM - 2, s6.atM + 2, () => ({ indicator: 'left', offRouteM: 20 }));
    expect(rules(drive(route, { mph: MPH, controls }))).toEqual([]);
  });
});

describe('FaultEvent', () => {
  it('has the fault_events shape with stable ids and times', () => {
    const [f] = runTrace(ctx(() => 'red'), drive(route, { toM: 100, mph: MPH, controls: careful }));
    const session = { sessionId: 'sess-1', learnerId: 'demo-learner', centreId: 'wanstead', startedAtMs: Date.UTC(2026, 9, 24, 10) };
    const e = toFaultEvent(f, 1, session, makeProjection(51.5797, 0.0236).toLatLng);
    expect(e).toMatchObject({
      _id: 'sess-1:1',
      sessionId: 'sess-1',
      learnerId: 'demo-learner',
      centreId: 'wanstead',
      junctionId: step('s1').junctionId,
      ruleId: 'R2',
      category: 'dangerous',
      speedMph: MPH,
      location: { type: 'Point' },
    });
    expect(e.ts.startsWith('2026-10-24T10:00:0')).toBe(true);
    const [lng, lat] = e.location.coordinates;
    expect(lat).toBeCloseTo(51.58, 1);
    expect(lng).toBeCloseTo(0.02, 1);
  });
});
