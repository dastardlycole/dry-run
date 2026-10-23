import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CENTRE } from '../../client/src/config';
import type { Building, Road, Vec2, WorldData } from '../../client/src/world/types';
import { ASSETS_DIR, DATA_DIR } from './env';
import { buildGraph, clipRuns, type ControlTag, type WayIn } from './osm/graph';
import { makeProjection } from './osm/project';
import {
  buildingHeightM,
  isRoundabout,
  lanesOf,
  layerOf,
  maxspeedMph,
  onewayOf,
  roadWidthM,
  type Tags,
} from './osm/tags';

// Turns the raw Overpass export (from osm-fetch) into assets/<centre>/world.json (SPEC §4.1 FR-W8).
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Tags;
}

/** Roads run a little past the building radius so the edge of the map isn't ragged. */
const ROAD_EXTENT_M = CENTRE.radiusM + 100;

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

const raw = JSON.parse(readFileSync(resolve(DATA_DIR, `${CENTRE.id}.osm.json`), 'utf8')) as { elements: OsmElement[] };
const proj = makeProjection(CENTRE.lat, CENTRE.lng);

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
  return !!p && Math.abs(p[0]) <= ROAD_EXTENT_M && Math.abs(p[1]) <= ROAD_EXTENT_M;
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
    buildings.push({ heightM: buildingHeightM(tags), footprint });
  }
}

const graph = buildGraph(graphWays, pos, controlTags);
for (const j of graph.junctions) {
  [j.lat, j.lng] = proj.toLatLng(j.pos).map((v) => Math.round(v * 1e7) / 1e7) as [number, number];
  j.pos = roundPt(j.pos);
}

const world: WorldData = {
  centre: CENTRE,
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

const outDir = resolve(ASSETS_DIR, CENTRE.id);
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'world.json');
const json = JSON.stringify(world);
writeFileSync(out, json);

const byType: Record<string, number> = {};
for (const j of world.junctions) byType[j.type] = (byType[j.type] ?? 0) + 1;
const lowConf = world.junctions.filter((j) => j.geometryConfidence === 'low').length;
console.log(`roads ${roads.length} · buildings ${buildings.length} · graph ${world.graph.nodes.length} nodes / ${world.graph.edges.length} edges`);
console.log(`junctions ${world.junctions.length} (${JSON.stringify(byType)}) · low confidence ${lowConf} · controls ${world.controls.length}`);
console.log(`Saved ${(json.length / 1e6).toFixed(2)} MB to ${out}`);
