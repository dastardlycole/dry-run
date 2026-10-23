import { describe, expect, it } from 'vitest';
import { buildingHeightM, lanesOf, layerOf, maxspeedMph, onewayOf, roadWidthM } from './tags';

describe('lanesOf', () => {
  it('reads the lanes tag with high confidence', () => {
    expect(lanesOf({ highway: 'primary', lanes: '4' })).toEqual({ lanes: 4, confidence: 'high' });
    expect(lanesOf({ highway: 'primary', lanes: '2;3' })).toEqual({ lanes: 2, confidence: 'high' });
  });

  it('guesses with low confidence when the tag is missing', () => {
    expect(lanesOf({ highway: 'residential' })).toEqual({ lanes: 2, confidence: 'low' });
    expect(lanesOf({ highway: 'residential', oneway: 'yes' })).toEqual({ lanes: 1, confidence: 'low' });
    expect(lanesOf({ highway: 'service' })).toEqual({ lanes: 1, confidence: 'low' });
  });
});

describe('roadWidthM', () => {
  it('is lanes × 3.2 m, with service roads at least 4 m', () => {
    expect(roadWidthM({ highway: 'primary' }, 2)).toBeCloseTo(6.4);
    expect(roadWidthM({ highway: 'service' }, 1)).toBe(4);
  });
});

describe('maxspeedMph', () => {
  it('reads UK mph tags', () => {
    expect(maxspeedMph({ maxspeed: '20 mph' })).toBe(20);
    expect(maxspeedMph({ maxspeed: '40 mph' })).toBe(40);
  });

  it('converts bare km/h numbers to the nearest 5 mph', () => {
    expect(maxspeedMph({ maxspeed: '50' })).toBe(30);
  });

  it('falls back to 30 mph (FR-W5)', () => {
    expect(maxspeedMph({})).toBe(30);
    expect(maxspeedMph({ maxspeed: 'national' })).toBe(30);
  });
});

describe('onewayOf', () => {
  it('reads the oneway tag', () => {
    expect(onewayOf({ oneway: 'yes' })).toBe('forward');
    expect(onewayOf({ oneway: '-1' })).toBe('backward');
    expect(onewayOf({ oneway: 'no', junction: 'roundabout' })).toBe('no');
    expect(onewayOf({})).toBe('no');
  });

  it('treats roundabouts and motorways as one-way', () => {
    expect(onewayOf({ junction: 'roundabout' })).toBe('forward');
    expect(onewayOf({ highway: 'motorway' })).toBe('forward');
  });
});

describe('layerOf', () => {
  it('uses the layer tag, else lifts bridges to 1', () => {
    expect(layerOf({ layer: '-1' })).toBe(-1);
    expect(layerOf({ bridge: 'yes' })).toBe(1);
    expect(layerOf({})).toBe(0);
  });
});

describe('buildingHeightM', () => {
  it('prefers height, then levels, then a guess by type', () => {
    expect(buildingHeightM({ building: 'yes', height: '12.5' })).toBe(12.5);
    expect(buildingHeightM({ building: 'yes', 'building:levels': '2' })).toBe(7);
    expect(buildingHeightM({ building: 'garage' })).toBe(3);
    expect(buildingHeightM({ building: 'house' })).toBe(7);
  });
});
