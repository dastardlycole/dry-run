import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorldData } from '../../client/src/world/types';
import { ASSETS_DIR, DATA_DIR } from './env';
import { worldSummary } from './osm/import';
import { addOvertureBuildings, fetchOverture, type OvertureFeature } from './osm/overture';

// Adds Overture buildings to a centre that's already built, without touching its roads or routes (row 25).
//   npm run overture -w tools -- goodmayes            (assets/goodmayes/world.json)
//   npm run overture -w tools -- tools/data/centres/chingford
// Reuses tools/data/overture/<id>.geojson if it's there; --fresh downloads it again.
const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Usage: npm run overture -w tools -- <centre id or folder> [--fresh]');
  process.exit(1);
}
// npm runs this from tools/; a folder is given from where the command was typed (INIT_CWD).
const asFolder = resolve(process.env.INIT_CWD ?? '.', target);
const dir = existsSync(resolve(asFolder, 'world.json')) ? asFolder : resolve(ASSETS_DIR, target);
const file = resolve(dir, 'world.json');
const world: WorldData = JSON.parse(readFileSync(file, 'utf8'));
const raw = resolve(DATA_DIR, 'overture', `${world.centre.id}.geojson`);

const features: OvertureFeature[] | null =
  !fresh && existsSync(raw) ? JSON.parse(readFileSync(raw, 'utf8')).features : await fetchOverture(world.centre, raw, 120_000, console.log);
if (!features) process.exit(1);

const osm = world.buildings.filter((b) => b.from !== 'overture').length;
const added = addOvertureBuildings(world, features);
writeFileSync(file, JSON.stringify(world));
console.log(`${world.centre.name}: ${osm} OSM buildings + ${added} from Overture (of ${features.length} downloaded)`);
console.log(worldSummary(world));
