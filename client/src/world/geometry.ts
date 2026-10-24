import type { Vec2 } from './types';

// Flat 2D shapes for road surfaces and markings. Pure maths so it can be unit tested.

/** Longest a corner offset may stretch, as a multiple of the offset, so sharp bends don't spike. */
const MAX_MITER = 2;

/**
 * The polyline shifted sideways by `offset` metres (positive = right of travel direction,
 * with x east and z south), or by `offset[i]` at point i. Corners use a capped miter.
 */
export function offsetPolyline(points: Vec2[], offset: number | number[]): Vec2[] {
  const n = points.length;
  const normals: (Vec2 | null)[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dz = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dz);
    // Right-hand normal when looking along (dx, dz) from above with z pointing south.
    normals.push(len > 1e-9 ? [-dz / len, dx / len] : null);
  }
  // A zero-length segment has no direction: borrow its neighbour's so the strip doesn't pinch.
  for (let i = 1; i < normals.length; i++) normals[i] ??= normals[i - 1];
  for (let i = normals.length - 2; i >= 0; i--) normals[i] ??= normals[i + 1];
  if (!normals[0]) return points.map((p) => [...p] as Vec2);
  const filled = normals as Vec2[];
  return points.map((p, i) => {
    const off = typeof offset === 'number' ? offset : offset[i];
    const a = filled[Math.max(0, i - 1)];
    const b = filled[Math.min(n - 2, i)];
    let mx = a[0] + b[0];
    let mz = a[1] + b[1];
    const mlen = Math.hypot(mx, mz);
    if (mlen < 1e-6) return [p[0] + a[0] * off, p[1] + a[1] * off];
    mx /= mlen;
    mz /= mlen;
    const cos = mx * b[0] + mz * b[1];
    const scale = Math.min(1 / Math.max(cos, 1e-6), MAX_MITER);
    return [p[0] + mx * off * scale, p[1] + mz * off * scale];
  });
}

/** Triangles (flat x,z triples) for a strip between offsets `left` and `right` along the polyline. */
export function stripTriangles(points: Vec2[], left: number, right: number): Vec2[] {
  const l = offsetPolyline(points, left);
  const r = offsetPolyline(points, right);
  const tris: Vec2[] = [];
  for (let i = 0; i < points.length - 1; i++) tris.push(l[i], l[i + 1], r[i], r[i], l[i + 1], r[i + 1]);
  return tris;
}

/**
 * Texture coordinates in metres for stripTriangles(points, left, right), vertex for vertex: u runs along
 * the road and v across it, so paving slabs and kerb stones follow the road round bends.
 */
export function stripUVs(points: Vec2[], left: number, right: number): Vec2[] {
  const uvs: Vec2[] = [];
  let s0 = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const s1 = s0 + Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    uvs.push([s0, left], [s1, left], [s0, right], [s0, right], [s1, left], [s1, right]);
    s0 = s1;
  }
  return uvs;
}

/** Triangles for a filled circle. */
export function discTriangles([cx, cz]: Vec2, radius: number, segments = 20): Vec2[] {
  const tris: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    tris.push([cx, cz], [cx + Math.cos(a1) * radius, cz + Math.sin(a1) * radius], [cx + Math.cos(a0) * radius, cz + Math.sin(a0) * radius]);
  }
  return tris;
}

export interface Circle {
  c: Vec2;
  r: number;
}

/**
 * Pieces of the polyline for a dashed line: `dash` metres on, `gap` off. Pass gap 0 for a solid line.
 * Parts inside the circles from `holesNear` (junctions) are left out. Cuts land exactly on dash and
 * circle edges, so straight stretches keep their original points.
 */
export function dashPieces(
  points: Vec2[],
  dash: number,
  gap: number,
  holesNear: (a: Vec2, b: Vec2) => Circle[] = () => [],
): Vec2[][] {
  const pieces: Vec2[][] = [];
  const period = dash + gap;
  let travelled = 0;
  let current: Vec2[] = [];
  const flush = () => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const at = (s: number): Vec2 => [a[0] + ux * s, a[1] + uz * s];
    const holes = holesNear(a, b);

    // Distances along this segment where the line may switch on or off.
    const cuts = [0, len];
    if (gap > 0) {
      for (let k = Math.floor(travelled / period); k * period < travelled + len; k++) {
        cuts.push(k * period - travelled, k * period + dash - travelled);
      }
    }
    for (const { c, r } of holes) {
      const proj = (c[0] - a[0]) * ux + (c[1] - a[1]) * uz;
      const perp2 = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 - proj * proj;
      if (perp2 >= r * r) continue;
      const half = Math.sqrt(r * r - perp2);
      cuts.push(proj - half, proj + half);
    }
    const sorted = cuts.filter((s) => s >= 0 && s <= len).sort((x, y) => x - y);

    for (let j = 0; j < sorted.length - 1; j++) {
      const s0 = sorted[j];
      const s1 = sorted[j + 1];
      if (s1 - s0 < 1e-9) continue;
      const mid = at((s0 + s1) / 2);
      const on =
        (gap === 0 || (travelled + (s0 + s1) / 2) % period < dash) &&
        !holes.some(({ c, r }) => Math.hypot(c[0] - mid[0], c[1] - mid[1]) < r);
      if (on) {
        if (current.length === 0) current.push(at(s0));
        current.push(s1 === len ? b : at(s1));
      } else flush();
    }
    travelled += len;
  }
  flush();
  return pieces;
}

/** Heading of a direction (dx, dz): 0 = east, positive = turned left (counter-clockwise from above). */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** Angle wrapped into (-π, π]. */
export function wrapAngle(a: number): number {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

export function polylineLength(points: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return len;
}

/** The point `d` metres along the polyline (clamped to its ends) and the unit direction of travel there. */
export function pointAlong(points: Vec2[], d: number): { p: Vec2; dir: Vec2 } {
  let left = Math.max(0, d);
  let last: { p: Vec2; dir: Vec2 } = { p: points[0], dir: [1, 0] };
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-9) continue;
    const dir: Vec2 = [(bx - ax) / len, (bz - az) / len];
    if (left <= len) return { p: [ax + dir[0] * left, az + dir[1] * left], dir };
    left -= len;
    last = { p: [bx, bz], dir };
  }
  return last;
}

/** Right-hand normal of a unit direction (see offsetPolyline: positive offsets go right). */
export const rightOf = ([ux, uz]: Vec2): Vec2 => [-uz, ux];

export const posKey = ([x, z]: Vec2) => `${x},${z}`;

/** Half the widest road through each road point, keyed by posKey: the radius of the patch drawn where roads meet. */
export function halfWidthsAt(roads: { widthM: number; points: Vec2[] }[]): Map<string, number> {
  const half = new Map<string, number>();
  for (const r of roads) for (const p of r.points) half.set(posKey(p), Math.max(half.get(posKey(p)) ?? 0, r.widthM / 2));
  return half;
}

/**
 * The point on the polyline nearest to `p`: distance `d`, on segment `k` (points k → k+1) at fraction `t`.
 * Only segments `from`..`to - 1` are searched.
 */
export function nearestOnPolyline(
  points: Vec2[],
  [px, pz]: Vec2,
  from = 0,
  to = points.length - 1,
): { d: number; k: number; t: number } {
  let best = { d: Infinity, k: Math.max(0, from), t: 0 };
  for (let k = Math.max(0, from); k < Math.min(to, points.length - 1); k++) {
    const [ax, az] = points[k];
    const [bx, bz] = points[k + 1];
    const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / len2)) : 0;
    const d = Math.hypot(px - ax - t * (bx - ax), pz - az - t * (bz - az));
    if (d < best.d) best = { d, k, t };
  }
  return best;
}
