import type { Building, Road, Vec2, WorldData } from '../../../client/src/world/types';
import { buildGraph, clipRuns, type ControlTag, type WayIn } from './graph';
import { roadExtentM, type Centre } from './overpass';
import { makeProjection } from './project';
import {
  buildingHeightM,
  isRoundabout,
  lanesOf,
  layerOf,
  maxspeedMph,
  onewayOf,
  roadWidthM,
  type Tags,
} from './tags';

// Turns the raw Overpass export (roadsQuery) into world.json for a centre (SPEC §4.1 FR-W8).
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: { type: string; ref: number; role: string }[];
  tags?: Tags;
}

/** Amenities with a shop front (not churches, schools or toilets). */
const SHOP_AMENITIES = new Set(['cafe', 'restaurant', 'pub', 'bar', 'fast_food', 'bank', 'pharmacy', 'post_office', 'dentist', 'veterinary', 'ice_cream', 'bureau_de_change']);

const CONTROL_TAGS: Record<string, ControlTag> = {
  traffic_signals: 'signals',
  give_way: 'giveway',
  stop: 'stop',
  crossing: 'crossing',
  mini_roundabout: 'mini_roundabout',
};

const round = (v: number) => Math.round(v * 100) / 100;
const roundPt = ([x, z]: Vec2): Vec2 => [round(x), round(z)];
/** Rounded points with repeats removed (nodes < 5 mm apart would make a zero-length segment). */
const roundedPath = (points: Vec2[]): Vec2[] =>
  points.map(roundPt).filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);

export function importWorld(raw: { elements: OsmElement[] }, centre: Centre): WorldData {
  const extentM = roadExtentM(centre);
  const proj = makeProjection(centre.lat, centre.lng);

  const pos = new Map<number, Vec2>();
  const controlTags = new Map<number, ControlTag>();
  const ways: OsmElement[] = [];
  for (const e of raw.elements) {
    if (e.type === 'node') {
      pos.set(e.id, proj.toLocal(e.lat!, e.lon!));
      const tag = CONTROL_TAGS[e.tags?.highway ?? ''];
      if (tag) controlTags.set(e.id, tag);
    } else if (e.type === 'way') ways.push(e);
  }

  const inside = (id: number) => {
    const p = pos.get(id);
    return !!p && Math.abs(p[0]) <= extentM && Math.abs(p[1]) <= extentM;
  };

  const roads: Road[] = [];
  const graphWays: WayIn[] = [];
  const buildings: Building[] = [];
  for (const w of ways) {
    const tags = w.tags ?? {};
    if (tags.highway) {
      const oneway = onewayOf(tags);
      const nodeIds = oneway === 'backward' ? [...w.nodes!].reverse() : w.nodes!;
      const { lanes, confidence } = lanesOf(tags);
      const speed = maxspeedMph(tags);
      for (const run of clipRuns(nodeIds, inside)) {
        const points = roundedPath(run.map((id) => pos.get(id)!));
        if (points.length < 2) continue;
        roads.push({
          wayId: w.id,
          name: tags.name ?? tags.ref,
          highway: tags.highway,
          lanes,
          widthM: roadWidthM(tags, lanes),
          maxspeedMph: speed,
          oneway: oneway !== 'no',
          layer: layerOf(tags),
          confidence,
          points,
        });
        graphWays.push({ id: w.id, nodeIds: run, oneway: oneway !== 'no', roundabout: isRoundabout(tags), maxspeedMph: speed, confidence });
      }
    } else if (tags.building) {
      const ids = w.nodes!;
      if (ids.length < 4 || !ids.every((id) => pos.has(id))) continue;
      const footprint = ids.slice(0, -1).map((id) => roundPt(pos.get(id)!)); // closed ring: drop the repeated last node
      const levels = parseFloat(tags['building:levels'] ?? '');
      buildings.push({
        heightM: buildingHeightM(tags),
        footprint,
        kind: tags.building,
        ...(levels > 0 && { levels }),
        ...((tags.shop || SHOP_AMENITIES.has(tags.amenity ?? '')) && { shop: true }),
      });
    }
  }

  const graph = buildGraph(graphWays, pos, controlTags);
  for (const j of graph.junctions) {
    [j.lat, j.lng] = proj.toLatLng(j.pos).map((v) => Math.round(v * 1e7) / 1e7) as [number, number];
    j.pos = roundPt(j.pos);
  }

  return {
    centre,
    generatedAt: new Date().toISOString(),
    roads,
    buildings,
    junctions: graph.junctions,
    controls: graph.controls.map((c) => ({ ...c, pos: roundPt(c.pos) })),
    graph: {
      nodes: graph.nodes.map((n) => ({ ...n, pos: roundPt(n.pos) })),
      edges: graph.edges.map((e) => ({ ...e, lengthM: round(e.lengthM), points: e.points.map(roundPt) })),
    },
  };
}

/** One line on what's in the map, for logs. */
export function worldSummary(world: WorldData): string {
  const byType: Record<string, number> = {};
  for (const j of world.junctions) byType[j.type] = (byType[j.type] ?? 0) + 1;
  const lowConf = world.junctions.filter((j) => j.geometryConfidence === 'low').length;
  return (
    `roads ${world.roads.length} · buildings ${world.buildings.length} · graph ${world.graph.nodes.length} nodes / ${world.graph.edges.length} edges\n` +
    `junctions ${world.junctions.length} (${JSON.stringify(byType)}) · low confidence ${lowConf} · controls ${world.controls.length}`
  );
}
