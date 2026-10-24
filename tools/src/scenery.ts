import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CENTRE } from '../../client/src/config';
import type { GreenArea, SceneryData, Vec2 } from '../../client/src/world/types';
import { ASSETS_DIR, DATA_DIR } from './env';
import { bboxAround, makeProjection } from './osm/project';
import type { Tags } from './osm/tags';
import { clipToSquare, greenKindOf, joinRings } from './scenery/shapes';

// Trees, parks, woods, water and street lamps around the centre → assets/<centre>/scenery.json.
// Looks only: nothing here changes roads, junctions or the route. Downloads once into tools/data;
// pass --refetch to download again.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** Scenery reaches a bit past the roads so the edge of the map isn't bare. */
const EXTENT_M = CENTRE.radiusM + 300;

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: { type: string; ref: number; role: string }[];
  tags?: Tags;
}

const rawPath = resolve(DATA_DIR, `${CENTRE.id}.scenery.osm.json`);
if (!existsSync(rawPath) || process.argv.includes('--refetch')) {
  const [s, w, n, e] = bboxAround(CENTRE.lat, CENTRE.lng, EXTENT_M);
  const bbox = `${s},${w},${n},${e}`;
  const green = '["natural"~"^(wood|scrub|heath|water)$"]';
  const land = '["landuse"~"^(forest|grass|meadow|recreation_ground|village_green|allotments|cemetery|reservoir|basin)$"]';
  const leisure = '["leisure"~"^(park|common|garden|pitch|golf_course)$"]';
  const query = `
[out:json][timeout:180];
(
  node["natural"="tree"](${bbox});
  way["natural"="tree_row"](${bbox});
  way${green}(${bbox}); way${land}(${bbox}); way${leisure}(${bbox});
  relation${green}(${bbox}); relation${land}(${bbox}); relation${leisure}(${bbox});
  node["highway"="street_lamp"](${bbox});
);
out body;
>;
out skel qt;
`;
  console.log(`Fetching scenery for ${CENTRE.name}…`);
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'dry-run-hackathon' },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass returned ${res.status}: ${await res.text()}`);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(rawPath, await res.text());
}

const raw = JSON.parse(readFileSync(rawPath, 'utf8')) as { elements: OsmElement[] };
const proj = makeProjection(CENTRE.lat, CENTRE.lng);
const round = (v: number) => Math.round(v * 100) / 100;
const pos = new Map<number, Vec2>();
const wayNodes = new Map<number, number[]>();
for (const e of raw.elements) {
  if (e.type === 'node') pos.set(e.id, proj.toLocal(e.lat!, e.lon!));
  else if (e.type === 'way') wayNodes.set(e.id, e.nodes ?? []);
}
const inMap = ([x, z]: Vec2) => Math.abs(x) <= EXTENT_M && Math.abs(z) <= EXTENT_M;
const path = (ids: number[]) => (ids.every((id) => pos.has(id)) ? ids.map((id) => pos.get(id)!) : null);
const roundAll = (pts: Vec2[]): Vec2[] => pts.map(([x, z]) => [round(x), round(z)]);

const scenery: SceneryData = { generatedAt: new Date().toISOString(), trees: [], treeRows: [], areas: [], lamps: [], crossings: [] };
const addArea = (kind: GreenArea['kind'], ring: Vec2[]) => {
  const clipped = clipToSquare(ring, EXTENT_M);
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

// Crossings come from the road download (osm-fetch), which already has every crossing node.
const roadsRaw = JSON.parse(readFileSync(resolve(DATA_DIR, `${CENTRE.id}.osm.json`), 'utf8')) as { elements: OsmElement[] };
for (const e of roadsRaw.elements) {
  const t = e.tags;
  if (e.type !== 'node' || t?.highway !== 'crossing') continue;
  // A zebra (with Belisha beacons) only where it is one: informal_zebra is just paint, with no right of way.
  const zebra = t.crossing === 'zebra' || t.crossing_ref === 'zebra' || (t['crossing:markings'] === 'zebra' && !t.crossing_ref);
  const kind = t.crossing === 'traffic_signals' ? 'signals' : zebra ? 'zebra' : null;
  if (kind) scenery.crossings.push({ pos: roundAll([proj.toLocal(e.lat!, e.lon!)])[0], kind });
}

const outDir = resolve(ASSETS_DIR, CENTRE.id);
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'scenery.json');
const json = JSON.stringify(scenery);
writeFileSync(out, json);
const byKind: Record<string, number> = {};
for (const a of scenery.areas) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
console.log(`trees ${scenery.trees.length} · tree rows ${scenery.treeRows.length} · lamps ${scenery.lamps.length} · crossings ${scenery.crossings.length} · areas ${JSON.stringify(byKind)}`);
console.log(`Saved ${(json.length / 1e6).toFixed(2)} MB to ${out}`);
