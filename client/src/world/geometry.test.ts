import { describe, expect, it } from 'vitest';
import { dashPieces, discTriangles, offsetPolyline, stripTriangles } from './geometry';
import type { Vec2 } from './types';

const close = (a: Vec2[], b: Vec2[]) => a.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(b[i][k], 6)));

describe('offsetPolyline', () => {
  it('shifts a road running east to the right (south, +z)', () => {
    close(offsetPolyline([[0, 0], [10, 0]], 2), [[0, 2], [10, 2]]);
    close(offsetPolyline([[0, 0], [10, 0]], -2), [[0, -2], [10, -2]]);
  });

  it('keeps the offset distance around a right-angle bend', () => {
    // east then south (a right turn): the right-hand offset cuts the inside corner
    close(offsetPolyline([[0, 0], [10, 0], [10, 10]], 1), [[0, 1], [9, 1], [9, 10]]);
  });

  it('does not pinch at a repeated last point', () => {
    close(offsetPolyline([[0, 0], [10, 0], [10, 0]], 2), [[0, 2], [10, 2], [10, 2]]);
  });

  it('caps the stretch at very sharp bends', () => {
    const [, mid] = offsetPolyline([[0, 0], [10, 0], [0, 0.1]], 1);
    expect(Math.hypot(mid[0] - 10, mid[1])).toBeLessThanOrEqual(2 + 1e-9);
  });
});

describe('stripTriangles', () => {
  it('makes two triangles per segment', () => {
    expect(stripTriangles([[0, 0], [10, 0], [20, 0]], -3, 3)).toHaveLength(12);
  });
});

describe('discTriangles', () => {
  it('stays within the radius', () => {
    for (const [x, z] of discTriangles([5, 5], 2, 8)) expect(Math.hypot(x - 5, z - 5)).toBeLessThanOrEqual(2 + 1e-9);
  });
});

describe('dashPieces', () => {
  it('cuts a 20 m line into exact 4 m dashes with 6 m gaps', () => {
    close(dashPieces([[0, 0], [20, 0]], 4, 6).flat(), [[0, 0], [4, 0], [10, 0], [14, 0]]);
  });

  it('carries a dash across a bend', () => {
    // 6 m on: 4 m along the first segment, 2 m down the second
    const pieces = dashPieces([[0, 0], [4, 0], [4, 10]], 6, 4);
    close(pieces[0], [[0, 0], [4, 0], [4, 2]]);
  });

  it('draws a solid line on the original points when the gap is 0', () => {
    expect(dashPieces([[0, 0], [10, 0], [10, 10]], 1, 0)).toEqual([[[0, 0], [10, 0], [10, 10]]]);
  });

  it('stops exactly at the edge of a junction circle', () => {
    const pieces = dashPieces([[0, 0], [20, 0]], 1, 0, () => [{ c: [10, 0], r: 2 }]);
    close(pieces.flat(), [[0, 0], [8, 0], [12, 0], [20, 0]]);
  });

  it('ignores zero-length segments', () => {
    expect(dashPieces([[0, 0], [5, 0], [5, 0], [10, 0]], 1, 0)).toEqual([[[0, 0], [5, 0], [10, 0]]]);
  });
});
