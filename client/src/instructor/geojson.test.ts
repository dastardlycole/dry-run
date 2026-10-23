import { describe, expect, it } from 'vitest';
import { collisionFeatures, collisionLine, faultRate, junctionFeatures } from './geojson';
import type { JunctionStatsResponse } from './types';

const r: JunctionStatsResponse = {
  updatedAt: null,
  junctions: [
    {
      id: 'rbt',
      name: 'A1008 / Cambridge Park',
      type: 'roundabout',
      lng: 0.03,
      lat: 51.58,
      faults: 5,
      byRule: { R9: 5 },
      sessionsThrough: 4,
      sessionsWithFault: 2,
      collisions: { total: 3, serious: 1, fatal: 0, since: '2021-01-01T00:00:00.000Z' },
    },
  ],
  collisions: [{ id: 'c1', lng: 0.03, lat: 51.58, severity: 'fatal', date: '2023-05-02T00:00:00.000Z' }],
};

describe('map features', () => {
  it('puts junctions and collisions at [lng, lat]', () => {
    expect(junctionFeatures(r).features[0]).toMatchObject({ geometry: { coordinates: [0.03, 51.58] }, properties: { id: 'rbt', faults: 5 } });
    expect(collisionFeatures(r).features[0].properties).toEqual({ severity: 'fatal', date: '2023-05-02' });
  });
});

describe('faultRate', () => {
  it('is the share of drives through the junction with a fault there', () => {
    expect(faultRate({ sessionsThrough: 4, sessionsWithFault: 2 })).toBe('50%');
    expect(faultRate({ sessionsThrough: 3, sessionsWithFault: 1 })).toBe('33%');
  });
  it('is null before anyone has driven through, and never over 100%', () => {
    expect(faultRate({ sessionsThrough: 0, sessionsWithFault: 0 })).toBeNull();
    expect(faultRate({ sessionsThrough: 1, sessionsWithFault: 2 })).toBe('100%');
  });
});

describe('collisionLine', () => {
  it('says how many collisions since when, and how bad', () => {
    expect(collisionLine(r.junctions[0].collisions)).toBe('3 reported collisions here since 2021 (1 serious)');
    expect(collisionLine({ total: 1, serious: 0, fatal: 0, since: '2021-01-01T00:00:00.000Z' })).toBe('1 reported collision here since 2021');
    expect(collisionLine({ total: 0, serious: 0, fatal: 0, since: null })).toBe('0 reported collisions here');
  });
});
