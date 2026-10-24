import { describe, expect, it } from 'vitest';
import demo from '../../../assets/wanstead/route-demo.json';
import world from '../../../assets/wanstead/world.json';
import type { Light } from '../world/lights';
import type { Route, RouteStep, WorldData } from '../world/types';
import { FaultEngine, runTrace, toFaultEvent } from './engine';
import { speedLimitAt } from './limits';
import { makeProjection } from '../world/projection';
import { countFaults, resultOf } from './result';
import { expectedSignal, LANE_SAMPLE_M, LOOK_BEFORE_LINE_S, MOVING_OFF_CHECK_S, SAME_CRASH_S } from './rules';
import { carefulControls, drive } from './trace';
import type { FaultContext, Frame } from './types';

// Rules R1–R9 and R11 on scripted drives along the real Wanstead demo route (SPEC §4.6 FR-F5).

const route = demo as Route;
const step = (id: string) => route.steps.find((s) => s.id === id)!;
const MPH = 25;
/** Seconds stood at the start before pulling away, in drives that start from the kerb. */
const WAIT = 3;
const careful = carefulControls(route, MPH);
/** The same, plus the checks before pulling away from the kerb. */
const carefulFromKerb = carefulControls(route, MPH, WAIT);

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

  it('gets no faults pulling away from the kerb at the start, either', () => {
    expect(runTrace(ctx(), drive(route, { mph: MPH, waitS: WAIT, controls: carefulFromKerb }))).toEqual([]);
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

  it("doesn't mark a turn the car drove straight past (a missed turn), with no mirror or signal", () => {
    // Up to the junction, then straight on: its place along the route stays at the junction as the car
    // moves away from the exit road.
    const controls = withChange(s7.atM - 100, Infinity, () => ({ indicator: 'off', mirror: false }));
    const upTo = drive(route, { mph: MPH, toM: s7.atM + 0.5, controls });
    const last = upTo[upTo.length - 1];
    const straightOn = Array.from({ length: 90 }, (_, i): Frame => ({
      ...last,
      t: last.t + (i + 1) / 30,
      routeM: last.routeM + Math.min(i, 3) * 0.3,
      offRouteM: (i + 1) * 0.37,
    }));
    expect(rules([...upTo, ...straightOn])).toEqual([]);
  });

  it("doesn't take a signal left on for the missed turn as a new one when the way back takes over", () => {
    const engine = new FaultEngine(ctx());
    const at = (t: number, m: number, change: Partial<Frame> = {}): Frame => ({ ...drive(route, { mph: MPH, fromM: m, toM: m })[0], t, ...change });
    // Mirror, then signal right, then on past the turn with the signal still on.
    const before = [at(0, 100, { mirror: true }), ...Array.from({ length: 200 }, (_, i) => at(1 + i / 30, 100 + i * 0.3, { indicator: 'right' }))];
    expect(before.flatMap((f) => engine.step(f))).toEqual([]);
    engine.setSteps([]);
    // The way back starts at 0 m along it, signal still on: no R3, and no turn judged on the jump.
    const after = Array.from({ length: 60 }, (_, i) => at(10 + i / 30, i * 0.3, { indicator: 'right' }));
    expect(after.flatMap((f) => engine.step(f))).toEqual([]);
  });

  it('marks the turn once the car is on the exit road, timed at the junction', () => {
    const controls = withChange(s7.atM - 100, s7.atM + 10, () => ({ indicator: 'off' }));
    const frames = drive(route, { mph: MPH, controls });
    const faults = runTrace(ctx(), frames);
    expect(faults.map((f) => f.ruleId)).toEqual(['R5']);
    const atJunction = frames.find((f) => f.routeM >= s7.atM)!;
    expect(faults[0].t).toBe(atJunction.t);
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

describe('R7 junction observation', () => {
  const s4 = step('s4');
  const s7 = step('s7');
  /** A careful drive with no looks (Q / E) at all. */
  const noLooks = (m: number) => ({ ...careful(m), lookLeft: false, lookRight: false });

  it('marks crossing a give-way line, or a roundabout give-way line, without looking', () => {
    const faults = runTrace(ctx(), drive(route, { mph: MPH, controls: noLooks }));
    expect(faults.map((f) => `${f.ruleId}:${f.junctionId}`)).toEqual([`R7:${s4.junctionId}`, `R7:${s7.junctionId}`]);
    expect(faults[0].context).toMatchObject({ stepId: 's4', action: 'roundabout', missed: ['right'] });
    expect(faults[1].context).toMatchObject({ stepId: 's7', action: 'right', missed: ['left', 'right'] });
  });

  it("doesn't judge traffic lights or a junction with no line", () => {
    const lights = route.steps.filter((s) => s.control === 'signals').map((s) => s.junctionId);
    expect(lights.length).toBeGreaterThan(0);
    const faults = runTrace(ctx(), drive(route, { mph: MPH, controls: noLooks }));
    expect(faults.filter((f) => lights.includes(f.junctionId) || f.junctionId === step('s6').junctionId)).toEqual([]);
  });

  it('judges a stop sign like a give-way, but not the stop line at lights', () => {
    const stopSign = route.steps.map((s) => (s.id === 's7' ? { ...s, control: 'stop' as const, line: { ...s.line!, kind: 'stop' as const } } : s));
    const faults = runTrace({ ...ctx(), steps: stopSign }, drive(route, { mph: MPH, controls: noLooks }));
    expect(faults.map((f) => `${f.ruleId}:${f.junctionId}`)).toEqual([`R7:${s4.junctionId}`, `R7:${s7.junctionId}`]);
  });

  it('needs both ways at a give-way', () => {
    const lineM = s7.line!.atM;
    const leftOnly = withChange(lineM - 50, lineM + 5, (c) => ({ lookLeft: c.lookLeft || c.lookRight, lookRight: false }));
    expect(rules(drive(route, { mph: MPH, controls: leftOnly }))).toEqual([`R7:driving:${s7.junctionId}`]);
  });

  it('needs only a look right at a roundabout', () => {
    const lineM = s4.line!.atM;
    const rightOnly = withChange(lineM - 50, lineM + 5, () => ({ lookLeft: false }));
    expect(rules(drive(route, { mph: MPH, controls: rightOnly }))).toEqual([]);
  });

  it(`marks looks more than ${LOOK_BEFORE_LINE_S} s before the line, as when waiting there and not looking again`, () => {
    const lineM = s7.line!.atM;
    const approach = drive(route, { toM: lineM - 1, mph: MPH, controls: careful });
    const last = approach.at(-1)!;
    const waiting = Array.from({ length: 30 * (LOOK_BEFORE_LINE_S + 1) }, (_, i) => ({ ...last, t: last.t + (i + 1) / 30, speedMph: 0, lookLeft: false, lookRight: false }));
    const t0 = waiting.at(-1)!.t;
    const away = drive(route, { fromM: lineM - 0.5, toM: lineM + 20, mph: 5 }).map((f) => ({ ...f, t: f.t + t0 + 1 / 30 }));
    // Only R7 here: the mirror and signal (R4, R5) aren't kept up while waiting in this made-up drive.
    const r7 = (frames: Frame[]) => rules(frames).filter((r) => r.startsWith('R7'));
    expect(r7([...approach, ...waiting, ...away])).toEqual([`R7:driving:${s7.junctionId}`]);
    // Looking again just before pulling out is fine.
    const looked = waiting.map((f, i) => (i > waiting.length - 30 ? { ...f, lookLeft: true, lookRight: true } : f));
    expect(r7([...approach, ...looked, ...away])).toEqual([]);
  });
});

describe('R8 moving off safely', () => {
  /** Pull away from the kerb at the start, with some of the checks left out while stood still. */
  const pullAway = (change: Partial<Frame>) =>
    rules(drive(route, { toM: 40, mph: MPH, waitS: WAIT, controls: (m, t) => ({ ...carefulFromKerb(m, t), ...(t < WAIT + 0.5 ? change : {}) }) }));

  it('marks pulling away without a mirror check, or without a look over the right shoulder', () => {
    expect(pullAway({ mirror: false })).toEqual([expect.stringMatching(/^R8:driving:/)]);
    expect(pullAway({ lookRight: false })).toEqual([expect.stringMatching(/^R8:driving:/)]);
    const [f] = runTrace(ctx(), drive(route, { toM: 10, mph: MPH, waitS: WAIT, controls: () => ({}) }));
    expect(f).toMatchObject({ ruleId: 'R8', context: { missed: ['mirror', 'right'] } });
  });

  it(`marks checks more than ${MOVING_OFF_CHECK_S} s before pulling away`, () => {
    // Checks in the first half second of standing still, then nothing until pulling away.
    const waitS = MOVING_OFF_CHECK_S + 1;
    const early = (m: number, t: number) => ({ ...careful(m), ...(t < 0.5 ? { mirror: true, lookRight: true } : {}) });
    const frames = drive(route, { toM: 40, mph: MPH, waitS, controls: early });
    expect(rules(frames)).toEqual([expect.stringMatching(/^R8:driving:/)]);
  });

  it("judges only the first pull away, not moving off again after stopping at lights", () => {
    const s1 = step('s1');
    const approach = drive(route, { toM: s1.line!.atM - 2, mph: MPH, waitS: WAIT, controls: carefulFromKerb });
    const last = approach.at(-1)!;
    const stopped = Array.from({ length: 60 }, (_, i) => ({ ...last, t: last.t + (i + 1) / 30, speedMph: 0 }));
    const t0 = stopped.at(-1)!.t;
    const away = drive(route, { fromM: last.routeM, toM: s1.atM + 30, mph: MPH, controls: careful }).map((f) => ({ ...f, t: f.t + t0 + 1 / 30 }));
    away[0] = { ...away[0], speedMph: 0 };
    expect(rules([...approach, ...stopped, ...away])).toEqual([]);
  });

  it("doesn't judge a drive first seen already moving", () => {
    expect(rules(drive(route, { fromM: 300, toM: 400, mph: MPH }))).toEqual([]);
  });
});

describe('R9 roundabout lane', () => {
  const s4 = step('s4');
  const lineM = s4.line!.atM;
  /** As if the approach had two 3.2 m lanes one way (the real one has one: see the last test). */
  const twoLanes: FaultContext['roadFor'] = () => ({ lanes: 2, widthM: 6.4, oneway: true });
  /** A careful drive at the roundabout `exit`, sitting `sideM` across from the driving line on the approach. */
  const atExit = (exit: number, sideM: number, roadFor = twoLanes) => {
    const r = { ...route, steps: route.steps.map((s) => (s.id === 's4' ? { ...s, exit } : s)) };
    const c = carefulControls(r, MPH);
    const controls = (m: number) => (m > lineM - LANE_SAMPLE_M - 10 && m < lineM + 2 ? { ...c(m), sideM } : c(m));
    return runTrace({ ...ctx(), steps: r.steps, roadFor }, drive(r, { mph: MPH, controls }))
      .filter((f) => f.ruleId === 'R9')
      .map((f) => `${f.ruleId}:${f.category}:${f.junctionId}:${f.context.lane}`);
  };

  it('wants the right lane for the third exit of three', () => {
    expect(atExit(3, 3.2)).toEqual([]);
    expect(atExit(3, 0)).toEqual([`R9:driving:${s4.junctionId}:1`]);
  });

  it('wants the left lane for the first exit', () => {
    expect(atExit(1, 0)).toEqual([]);
    expect(atExit(1, 3.2)).toEqual([`R9:driving:${s4.junctionId}:2`]);
  });

  it('allows either lane for straight on', () => {
    expect(atExit(2, 0)).toEqual([]);
    expect(atExit(2, 3.2)).toEqual([]);
  });

  it('goes by where the car sat on the approach, not one moment', () => {
    // Left lane all the way up, a swerve right only in the last metre: still the left lane.
    const c = carefulControls(route, MPH);
    const controls = (m: number) => (m > lineM - 1 && m < lineM + 2 ? { ...c(m), sideM: 3.2 } : c(m));
    const faults = runTrace({ ...ctx(), roadFor: twoLanes }, drive(route, { mph: MPH, controls }));
    expect(faults.map((f) => f.ruleId)).toEqual(['R9']);
    expect(faults[0].context).toMatchObject({ lane: 1, expectedLane: 2 });
  });

  it('counts only the lanes going the same way on a two-way road', () => {
    // Two lanes on a two-way road is one each way: in the "right lane" is in the oncoming one.
    expect(atExit(3, 0, () => ({ lanes: 2, widthM: 6.4, oneway: false }))).toEqual([]);
    // Four lanes two-way is two each way.
    expect(atExit(3, 0, () => ({ lanes: 4, widthM: 12.8, oneway: false }))).toEqual([`R9:driving:${s4.junctionId}:1`]);
    expect(atExit(3, 3.2, () => ({ lanes: 4, widthM: 12.8, oneway: false }))).toEqual([]);
  });

  it('forgets where the car sat on an approach it left without crossing the line', () => {
    // Up the approach in the right lane, then reset to the start; the second time round, the left lane.
    const c = carefulControls(route, MPH);
    const lane = (m: number, sideM: number) => (m > lineM - LANE_SAMPLE_M - 10 && m < lineM + 2 ? { ...c(m), sideM } : c(m));
    const first = drive(route, { toM: lineM - 5, mph: MPH, controls: (m) => lane(m, 3.2) });
    const t0 = first.at(-1)!.t + 1;
    const again = drive(route, { mph: MPH, controls: (m) => lane(m, 0) }).map((f) => ({ ...f, t: f.t + t0 }));
    const faults = runTrace({ ...ctx(), roadFor: twoLanes }, [...first, ...again]).filter((f) => f.ruleId === 'R9');
    expect(faults.map((f) => f.context.lane)).toEqual([1]);
  });

  it("can't mark a lane on the real demo approach, which has one lane in OSM", () => {
    const w = world as unknown as WorldData;
    const wayOf = new Map(w.graph.edges.map((e) => [e.id, e.wayId]));
    const roadFor = (id: string) => w.roads.find((r) => r.wayId === wayOf.get(id));
    expect(roadFor(s4.approachEdgeId)?.lanes).toBe(1);
    expect(atExit(3, 3.2, roadFor)).toEqual([]);
  });
});

describe('R11 collision', () => {
  /** A careful drive touching `contact` between each pair of route distances. */
  const hits = (...spans: [number, number][]) =>
    rules(
      drive(route, {
        mph: MPH,
        controls: (m) => ({ ...careful(m), contact: spans.some(([a, b]) => m >= a && m < b) ? 'parkedCar' : null }),
      }),
    );

  it('marks one dangerous fault for a crash, however long the car stays touching', () => {
    expect(hits([300, 340])).toEqual([expect.stringMatching(/^R11:dangerous:/)]);
  });

  it(`counts bounces less than ${SAME_CRASH_S} s apart as the same crash`, () => {
    const v = MPH / 2.23694;
    expect(hits([300, 301], [300 + (SAME_CRASH_S - 0.5) * v, 301 + (SAME_CRASH_S - 0.5) * v])).toHaveLength(1);
  });

  it('marks two crashes further apart than that as two faults', () => {
    const gap = (SAME_CRASH_S + 1) * (MPH / 2.23694);
    expect(hits([300, 301], [301 + gap, 302 + gap])).toHaveLength(2);
  });

  it('says what the car hit', () => {
    const frames = drive(route, { mph: MPH, controls: (m) => ({ ...careful(m), contact: m > 300 && m < 301 ? 'building' : null }) });
    expect(runTrace(ctx(), frames)[0].context).toEqual({ with: 'building' });
  });
});

describe('result', () => {
  const n = (driving: number, serious = 0, dangerous = 0) => ({ driving, serious, dangerous });

  it('passes with up to 15 driving faults', () => {
    expect(resultOf(n(0))).toBe('PASS');
    expect(resultOf(n(15))).toBe('PASS');
  });

  it('fails with 16 driving faults, or any serious or dangerous one', () => {
    expect(resultOf(n(16))).toBe('FAIL');
    expect(resultOf(n(0, 1))).toBe('FAIL');
    expect(resultOf(n(0, 0, 1))).toBe('FAIL');
  });

  it('counts faults by category', () => {
    const faults = [{ category: 'driving' }, { category: 'dangerous' }, { category: 'driving' }] as const;
    expect(countFaults([...faults])).toEqual(n(2, 0, 1));
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
