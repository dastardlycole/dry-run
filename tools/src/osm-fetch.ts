import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CENTRE } from '../../client/src/config';
import { DATA_DIR } from './env';
import { bboxAround } from './osm/project';

// Downloads the raw OSM data around the test centre (SPEC §4.1). Run once; osm-import reads the saved file.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const [south, west, north, east] = bboxAround(CENTRE.lat, CENTRE.lng, CENTRE.radiusM);
const bbox = `${south},${west},${north},${east}`;

const query = `
[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$"](${bbox});
  way["building"](${bbox});
  node["highway"~"^(traffic_signals|give_way|stop|crossing|mini_roundabout)$"](${bbox});
);
out body;
>;
out skel qt;
`;

console.log(`Fetching OSM data for ${CENTRE.name} (bbox ${bbox})…`);
const res = await fetch(OVERPASS_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'dry-run-hackathon' },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass returned ${res.status}: ${await res.text()}`);
const text = await res.text();

mkdirSync(DATA_DIR, { recursive: true });
const out = resolve(DATA_DIR, `${CENTRE.id}.osm.json`);
writeFileSync(out, text);
console.log(`Saved ${(text.length / 1e6).toFixed(1)} MB to ${out}`);
