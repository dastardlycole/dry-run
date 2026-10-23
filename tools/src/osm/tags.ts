import type { Confidence } from '../../../client/src/world/types';

// Reading OSM tags into the numbers the sim needs (SPEC §4.1 FR-W5, FR-W10).
export type Tags = Record<string, string | undefined>;

export const LANE_WIDTH_M = 3.2;
export const DEFAULT_MAXSPEED_MPH = 30;
const KMH_PER_MPH = 1.609344;

/** Lanes from the `lanes` tag, or a guess from the road type (then confidence is low). */
export function lanesOf(tags: Tags): { lanes: number; confidence: Confidence } {
  const n = parseInt(tags.lanes ?? '', 10);
  if (n > 0) return { lanes: n, confidence: 'high' };
  if (tags.highway?.startsWith('service')) return { lanes: 1, confidence: 'low' };
  return { lanes: onewayOf(tags) === 'no' ? 2 : 1, confidence: 'low' };
}

export function roadWidthM(tags: Tags, lanes: number): number {
  // Service roads are often single-track but still two-way; keep them wide enough to pass a car.
  return Math.max(lanes * LANE_WIDTH_M, tags.highway === 'service' ? 4 : 0);
}

/** Speed limit in mph. UK tags are usually "30 mph"; a bare number means km/h in OSM. */
export function maxspeedMph(tags: Tags): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?\s*$/i.exec(tags.maxspeed ?? '');
  if (!m) return DEFAULT_MAXSPEED_MPH;
  const v = parseFloat(m[1]);
  return m[2]?.toLowerCase() === 'mph' ? v : Math.round(v / KMH_PER_MPH / 5) * 5;
}

/** 'forward' / 'backward' relative to the way's node order, or 'no'. */
export function onewayOf(tags: Tags): 'forward' | 'backward' | 'no' {
  const o = tags.oneway;
  if (o === '-1' || o === 'reverse') return 'backward';
  if (o === 'yes' || o === '1' || o === 'true') return 'forward';
  if (o === 'no') return 'no';
  if (isRoundabout(tags) || tags.highway === 'motorway' || tags.highway === 'motorway_link') return 'forward';
  return 'no';
}

export function isRoundabout(tags: Tags): boolean {
  return tags.junction === 'roundabout' || tags.junction === 'circular';
}

export function layerOf(tags: Tags): number {
  const l = parseInt(tags.layer ?? '', 10);
  if (Number.isFinite(l)) return l;
  return tags.bridge && tags.bridge !== 'no' ? 1 : 0;
}

const SMALL_BUILDINGS = new Set(['garage', 'garages', 'shed', 'hut', 'carport', 'kiosk']);

export function buildingHeightM(tags: Tags): number {
  const h = parseFloat(tags.height ?? '');
  if (h > 0) return h;
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (levels > 0) return levels * 3 + 1;
  return SMALL_BUILDINGS.has(tags.building ?? '') ? 3 : 7;
}
