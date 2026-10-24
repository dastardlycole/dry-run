import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CENTRE } from '../../client/src/config';
import { DATA_DIR } from './env';
import { overpass, roadsQuery } from './osm/overpass';

// Downloads the raw OSM data around the test centre (SPEC §4.1). Run once; osm-import reads the saved file.
console.log(`Fetching OSM data for ${CENTRE.name}…`);
const text = await overpass(roadsQuery(CENTRE));

mkdirSync(DATA_DIR, { recursive: true });
const out = resolve(DATA_DIR, `${CENTRE.id}.osm.json`);
writeFileSync(out, text);
console.log(`Saved ${(text.length / 1e6).toFixed(1)} MB to ${out}`);
