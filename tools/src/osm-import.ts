import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CENTRE } from '../../client/src/config';
import { ASSETS_DIR, DATA_DIR } from './env';
import { importWorld, worldSummary } from './osm/import';

// Turns the raw Overpass export (from osm-fetch) into assets/<centre>/world.json (SPEC §4.1 FR-W8).
const raw = JSON.parse(readFileSync(resolve(DATA_DIR, `${CENTRE.id}.osm.json`), 'utf8'));
const world = importWorld(raw, CENTRE);

const outDir = resolve(ASSETS_DIR, CENTRE.id);
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'world.json');
const json = JSON.stringify(world);
writeFileSync(out, json);
console.log(worldSummary(world));
console.log(`Saved ${(json.length / 1e6).toFixed(2)} MB to ${out}`);
