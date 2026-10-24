import type { GreenKind, Vec2 } from '../../../client/src/world/types';
import type { Tags } from '../osm/tags';

// Pure helpers for the scenery import: which OSM areas are green, joining split outlines, clipping to the map.

/** What kind of green area (or water) an OSM element is, if any. */
export function greenKindOf(tags: Tags): GreenKind | null {
  if (tags.natural === 'water' || tags.landuse === 'reservoir' || tags.landuse === 'basin') return 'water';
  if (tags.natural === 'wood' || tags.landuse === 'forest') return 'wood';
  if (tags.natural === 'scrub' || tags.natural === 'heath') return 'scrub';
  if (tags.leisure === 'pitch' || tags.leisure === 'golf_course') return 'pitch';
  if (tags.leisure === 'park' || tags.leisure === 'common' || tags.leisure === 'garden' || tags.landuse === 'cemetery') return 'park';
  if (['grass', 'meadow', 'recreation_ground', 'village_green', 'allotments'].includes(tags.landuse ?? '')) return 'grass';
  return null;
}

/**
 * Closed rings from pieces of outline that meet end to end (how OSM stores big multipolygon outlines).
 * Pieces may need reversing. Anything that doesn't close up is dropped.
 */
export function joinRings(pieces: Vec2[][]): Vec2[][] {
  const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings: Vec2[][] = [];
  while (left.length) {
    const ring = left.shift()!;
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        const end = ring[ring.length - 1];
        if (same(p[0], end)) ring.push(...p.slice(1));
        else if (same(p[p.length - 1], end)) ring.push(...[...p].reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring.slice(0, -1));
  }
  return rings;
}

/** The ring clipped to the square |x|, |z| <= half (Sutherland–Hodgman). Empty if it's all outside. */
export function clipToSquare(ring: Vec2[], half: number): Vec2[] {
  const edges: [(p: Vec2) => boolean, (a: Vec2, b: Vec2) => Vec2][] = [
    [(p) => p[0] <= half, (a, b) => cut(a, b, 0, half)],
    [(p) => p[0] >= -half, (a, b) => cut(a, b, 0, -half)],
    [(p) => p[1] <= half, (a, b) => cut(a, b, 1, half)],
    [(p) => p[1] >= -half, (a, b) => cut(a, b, 1, -half)],
  ];
  let out = ring;
  for (const [inside, meet] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      if (inside(b)) {
        if (!inside(a)) out.push(meet(a, b));
        out.push(b);
      } else if (inside(a)) out.push(meet(a, b));
    }
    if (!out.length) return [];
  }
  return out;
}

function cut(a: Vec2, b: Vec2, axis: 0 | 1, at: number): Vec2 {
  const t = (at - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
