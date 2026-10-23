import type { FeatureCollection, Point } from 'geojson';
import type { CollisionSummary, JunctionStat, JunctionStatsResponse } from './types';

// /api/junctions/stats → GeoJSON for the dashboard's map layers, and the text for a junction's popup.

/** Every junction with faults or collisions; the heatmap weighs them by faults (0 adds nothing). */
export function junctionFeatures(r: JunctionStatsResponse): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: r.junctions.map((j) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [j.lng, j.lat] },
      properties: { id: j.id, faults: j.faults },
    })),
  };
}

export function collisionFeatures(r: JunctionStatsResponse): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: r.collisions.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: { severity: c.severity, date: c.date.slice(0, 10) },
    })),
  };
}

/** "40%", or null when no session has been through yet. */
export function faultRate(j: Pick<JunctionStat, 'sessionsThrough' | 'sessionsWithFault'>): string | null {
  if (!j.sessionsThrough) return null;
  return `${Math.round((100 * Math.min(j.sessionsWithFault, j.sessionsThrough)) / j.sessionsThrough)}%`;
}

export function collisionLine(c: CollisionSummary): string {
  const since = c.since ? ` since ${c.since.slice(0, 4)}` : '';
  const n = `${c.total} reported collision${c.total === 1 ? '' : 's'} here${since}`;
  const bad = [c.fatal && `${c.fatal} fatal`, c.serious && `${c.serious} serious`].filter(Boolean);
  return bad.length ? `${n} (${bad.join(', ')})` : n;
}

const TYPE_LABEL: Record<string, string> = {
  roundabout: 'Roundabout',
  signals: 'Traffic lights',
  giveway: 'Give way',
  stop: 'Stop junction',
  crossing: 'Crossing',
  plain: 'Junction',
};

export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;
