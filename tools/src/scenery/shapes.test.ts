import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../client/src/world/types';
import { clipToSquare, greenKindOf, joinRings } from './shapes';

describe('greenKindOf', () => {
  it('sorts OSM tags into the kinds the sim draws', () => {
    expect(greenKindOf({ leisure: 'park' })).toBe('park');
    expect(greenKindOf({ natural: 'wood' })).toBe('wood');
    expect(greenKindOf({ landuse: 'forest' })).toBe('wood');
    expect(greenKindOf({ leisure: 'pitch', sport: 'soccer' })).toBe('pitch');
    expect(greenKindOf({ natural: 'water' })).toBe('water');
    expect(greenKindOf({ landuse: 'grass' })).toBe('grass');
    expect(greenKindOf({ building: 'house' })).toBeNull();
  });
});

describe('joinRings', () => {
  it('joins pieces end to end, reversing where needed, into a ring without the repeated point', () => {
    const rings = joinRings([
      [[0, 0], [10, 0]],
      [[10, 10], [10, 0]], // backwards
      [[10, 10], [0, 10], [0, 0]],
    ]);
    expect(rings).toEqual([[[0, 0], [10, 0], [10, 10], [0, 10]]]);
  });

  it('drops outlines that never close', () => {
    expect(joinRings([[[0, 0], [10, 0], [10, 10]]])).toEqual([]);
  });
});

describe('clipToSquare', () => {
  it('keeps a ring that is inside (it may start from another corner)', () => {
    const ring: Vec2[] = [[0, 0], [5, 0], [5, 5]];
    const clipped = clipToSquare(ring, 10);
    expect(clipped).toHaveLength(3);
    expect(clipped).toEqual(expect.arrayContaining(ring));
  });

  it('cuts a ring that crosses the edge', () => {
    const clipped = clipToSquare([[0, 0], [20, 0], [20, 5], [0, 5]], 10);
    expect(Math.max(...clipped.map((p) => p[0]))).toBe(10);
    expect(clipped).toHaveLength(4);
  });

  it('returns nothing for a ring outside', () => {
    expect(clipToSquare([[20, 20], [30, 20], [30, 30]], 10)).toEqual([]);
  });
});
