import { describe, expect, it } from 'vitest';
import {
  buildSiteLights,
  CROSSING_TIMING,
  cycleOf,
  JUNCTION_TIMING,
  lightAt,
  signalSites,
  siteLight,
  TrafficLights,
  type Light,
} from './lights';
import type { Edge, Junction, Vec2 } from './types';

const junction = (id: string, pos: Vec2, type: Junction['type'] = 'signals'): Junction => ({
  id,
  type,
  pos,
  lat: 0,
  lng: 0,
  degree: 4,
  geometryConfidence: 'high',
});
const edge = (id: string, from: string, to: string, a: Vec2, b: Vec2): Edge => ({
  id,
  from,
  to,
  wayId: 1,
  lengthM: Math.hypot(b[0] - a[0], b[1] - a[1]),
  maxspeedMph: 30,
  points: [a, b],
});

describe('lightAt', () => {
  it('runs the UK sequence green → amber → red → red+amber', () => {
    const seen: Light[] = [];
    for (let t = 0; t < cycleOf(JUNCTION_TIMING); t += 0.5) {
      const l = lightAt(t, JUNCTION_TIMING);
      if (seen[seen.length - 1] !== l) seen.push(l);
    }
    expect(seen).toEqual(['green', 'amber', 'red', 'redAmber']);
    expect(lightAt(cycleOf(JUNCTION_TIMING) + 1, JUNCTION_TIMING)).toBe('green');
    expect(lightAt(-1, JUNCTION_TIMING)).toBe('redAmber');
  });
});

describe('signalSites', () => {
  it('groups signal junctions close together and leaves the rest alone', () => {
    const sites = signalSites([
      junction('a', [0, 0]),
      junction('b', [12, 0]),
      junction('c', [30, 0]), // 18 m from b: joins the chain
      junction('d', [200, 0]),
      junction('e', [5, 5], 'giveway'),
    ]);
    expect(sites.map((s) => s.nodeIds)).toEqual([['a', 'b', 'c'], ['d']]);
    expect(sites[0].id).toBe('a');
    expect(sites[0].pos).toEqual([14, 0]);
  });
});

describe('TrafficLights', () => {
  // A crossroads at X: roads from the west, east, north and south.
  const edges = [
    edge('fromW', 'w', 'X', [-100, 0], [0, 0]),
    edge('fromE', 'e', 'X', [100, 0], [0, 0]),
    edge('fromN', 'n', 'X', [0, -100], [0, 0]),
    edge('fromS', 's', 'X', [0, 100], [0, 0]),
    edge('toW', 'X', 'w', [0, 0], [-100, 0]),
  ];
  const sites = buildSiteLights(signalSites([junction('X', [0, 0])]), edges, () => false);
  const lights = new TrafficLights(sites);
  const offset = sites[0].offset;

  it('gives opposite roads the same light and crossing roads take turns', () => {
    for (let t = 0; t < cycleOf(JUNCTION_TIMING); t += 0.5) {
      const ew = lights.stateFor('fromW', t);
      expect(lights.stateFor('fromE', t)).toBe(ew);
      expect(lights.stateFor('fromN', t)).toBe(lights.stateFor('fromS', t));
      // Never green both ways at once.
      expect(ew === 'green' && lights.stateFor('fromN', t) === 'green').toBe(false);
    }
    expect(lights.stateFor('fromW', -offset)).toBe('green');
    expect(lights.stateFor('fromN', -offset)).toBe('red');
    expect(lights.stateFor('fromN', -offset + cycleOf(JUNCTION_TIMING) / 2)).toBe('green');
  });

  it('has an all-red moment between the two groups', () => {
    const t = -offset + JUNCTION_TIMING.green + JUNCTION_TIMING.amber + 0.5;
    expect(lights.stateFor('fromW', t)).toBe('red');
    expect(lights.stateFor('fromN', t)).toBe('red');
  });

  it('still takes turns when the timing is a copy', () => {
    const copy = { ...sites[0], timing: { ...JUNCTION_TIMING } };
    expect(siteLight(copy, 0, -offset)).toBe('green');
    expect(siteLight(copy, 1, -offset)).toBe('red');
  });

  it('knows nothing about roads leaving the junction', () => {
    expect(lights.stateFor('toW', 0)).toBeUndefined();
  });

  it('uses crossing timing when all roads are on one line', () => {
    const [crossing] = buildSiteLights(signalSites([junction('X', [0, 0])]), edges.slice(0, 2), () => false);
    expect(crossing.timing).toBe(CROSSING_TIMING);
    expect(crossing.approaches.every((a) => a.group === 0)).toBe(true);
    expect(siteLight(crossing, 0, -crossing.offset)).toBe('green');
  });
});
