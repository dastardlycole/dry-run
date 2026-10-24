import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CENTRE } from '../../client/src/config';
import { ASSETS_DIR, DATA_DIR } from './env';
import { overpass, sceneryQuery } from './osm/overpass';
import { buildScenery, scenerySummary } from './scenery/build';

// Trees, parks, woods, water and street lamps around the centre → assets/<centre>/scenery.json.
// Looks only: nothing here changes roads, junctions or the route. Downloads once into tools/data;
// pass --refetch to download again.

const rawPath = resolve(DATA_DIR, `${CENTRE.id}.scenery.osm.json`);
if (!existsSync(rawPath) || process.argv.includes('--refetch')) {
  console.log(`Fetching scenery for ${CENTRE.name}…`);
  const text = await overpass(sceneryQuery(CENTRE));
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(rawPath, text);
}

const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const roadsRaw = JSON.parse(readFileSync(resolve(DATA_DIR, `${CENTRE.id}.osm.json`), 'utf8'));
const scenery = buildScenery(raw, roadsRaw, CENTRE);

const outDir = resolve(ASSETS_DIR, CENTRE.id);
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'scenery.json');
const json = JSON.stringify(scenery);
writeFileSync(out, json);
console.log(scenerySummary(scenery));
console.log(`Saved ${(json.length / 1e6).toFixed(2)} MB to ${out}`);
