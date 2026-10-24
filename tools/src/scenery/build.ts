import type { GreenArea, SceneryData, Vec2 } from '../../../client/src/world/types';
import type { OsmElement } from '../osm/import';
import { sceneryExtentM, type Centre } from '../osm/overpass';
import { makeProjection } from '../osm/project';
import { clipToSquare, greenKindOf, joinRings } from './shapes';

// Trees, parks, woods, water and street lamps around the centre → scenery.json. Looks only: nothing here
// changes roads, junctions or the route. `raw` is the scenery download (sceneryQuery); crossings come from
// the road download (roadsQuery), which already has every crossing node.

type Raw = { elements: OsmElement[] };

export function buildScenery(raw: Raw, roadsRaw: Raw, centre: Centre): SceneryData {
  const extentM = sceneryExtentM(centre);
  const proj = makeProjection(centre.lat, centre.lng);
  const round = (v: number) => Math.round(v * 100) / 100;
  const pos = new Map<number, Vec2>();
  const wayNodes = new Map<number, number[]>();
  for (const e of raw.elements) {
    if (e.type === 'node') pos.set(e.id, proj.toLocal(e.lat!, e.lon!));
    else if (e.type === 'way') wayNodes.set(e.id, e.nodes ?? []);
  }
  const inMap = ([x, z]: Vec2) => Math.abs(x) <= extentM && Math.abs(z) <= extentM;
  const path = (ids: number[]) => (ids.every((id) => pos.has(id)) ? ids.map((id) => pos.get(id)!) : null);
  const roundAll = (pts: Vec2[]): Vec2[] => pts.map(([x, z]) => [round(x), round(z)]);

  const scenery: SceneryData = { generatedAt: new Date().toISOString(), trees: [], treeRows: [], areas: [], lamps: [], crossings: [] };
  const addArea = (kind: GreenArea['kind'], ring: Vec2[]) => {
    const clipped = clipToSquare(ring, extentM);
    if (clipped.length >= 3) scenery.areas.push({ kind, ring: roundAll(clipped) });
  };

  for (const e of raw.elements) {
    const tags = e.tags;
    if (!tags) continue;
    if (e.type === 'node') {
      const p = pos.get(e.id)!;
      if (!inMap(p)) continue;
      if (tags.natural === 'tree') scenery.trees.push(roundAll([p])[0]);
      else if (tags.highway === 'street_lamp') scenery.lamps.push(roundAll([p])[0]);
    } else if (e.type === 'way') {
      const pts = path(e.nodes ?? []);
      if (!pts) continue;
      if (tags.natural === 'tree_row') {
        if (pts.some(inMap)) scenery.treeRows.push(roundAll(pts));
        continue;
      }
      const kind = greenKindOf(tags);
      if (kind && e.nodes![0] === e.nodes![e.nodes!.length - 1]) addArea(kind, pts.slice(0, -1));
    } else if (e.type === 'relation') {
      const kind = greenKindOf(tags);
      if (!kind) continue;
      const outers = (e.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner');
      const pieces = outers.flatMap((m) => {
        const pts = path(wayNodes.get(m.ref) ?? []);
        return pts ? [pts] : [];
      });
      for (const ring of joinRings(pieces)) addArea(kind, ring);
    }
  }

  for (const e of roadsRaw.elements) {
    const t = e.tags;
    if (e.type !== 'node' || t?.highway !== 'crossing') continue;
    // A zebra (with Belisha beacons) only where it is one: informal_zebra is just paint, with no right of way.
    const zebra = t.crossing === 'zebra' || t.crossing_ref === 'zebra' || (t['crossing:markings'] === 'zebra' && !t.crossing_ref);
    const kind = t.crossing === 'traffic_signals' ? 'signals' : zebra ? 'zebra' : null;
    if (kind) scenery.crossings.push({ pos: roundAll([proj.toLocal(e.lat!, e.lon!)])[0], kind });
  }
  return scenery;
}

/** One line on what's in the scenery, for logs. */
export function scenerySummary(s: SceneryData): string {
  const byKind: Record<string, number> = {};
  for (const a of s.areas) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  return `trees ${s.trees.length} · tree rows ${s.treeRows.length} · lamps ${s.lamps.length} · crossings ${s.crossings.length} · areas ${JSON.stringify(byKind)}`;
}
