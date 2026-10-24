import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorldData } from '../../../client/src/world/types';
import { DATA_DIR } from '../env';
import { importWorld, worldSummary } from '../osm/import';
import { overpass, roadsQuery, sceneryQuery, type Centre } from '../osm/overpass';
import { addOvertureBuildings, fetchOverture } from '../osm/overture';
import { autoRoutes } from '../route/auto';
import { buildScenery, scenerySummary } from '../scenery/build';
import type { CentreInfo } from './finder';

// Everything the sim needs for one test centre, with no hand work (SPEC §16, row 22): download the roads
// and scenery from OSM, build world.json and scenery.json, and make test routes from the road graph.
// Used by `npm run centre-build -w tools` and by the server when a learner types a new centre.

/** How far the map reaches from the centre, as at Wanstead. */
export const CENTRE_RADIUS_M = 1000;

/** The stages of a build, for the loading bar (centre-build prints "@@step <n>/<of> <label>"). */
export const STAGES = ['Downloading the roads', 'Downloading parks and trees', 'Adding more buildings', 'Building the streets', 'Planning test routes'] as const;
/** Overture's download takes ~6 s; past this it's stuck, and the map is fine with OSM buildings only. */
const OVERTURE_LIMIT_MS = 30_000;

export const stepLine = (i: number) => `@@step ${i + 1}/${STAGES.length} ${STAGES[i]}`;

// The address goes into world.json for the place line at the top of the screen ("… · Goodmayes, Ilford").
export const toCentre = (c: CentreInfo): Centre => ({
  id: c.id,
  name: c.name,
  lat: c.lat,
  lng: c.lng,
  radiusM: CENTRE_RADIUS_M,
  address: c.address,
  postcode: c.postcode,
});

/** Builds the centre into `outDir` and returns the route ids made. Throws if no route could be made. */
export async function buildCentre(info: CentreInfo, outDir: string, log: (line: string) => void = console.log): Promise<string[]> {
  const centre = toCentre(info);
  log(stepLine(0));
  const roadsRaw = JSON.parse(await overpass(roadsQuery(centre)));
  log(stepLine(1));
  const sceneryRaw = JSON.parse(await overpass(sceneryQuery(centre)));

  log(stepLine(2));
  const world: WorldData = importWorld(roadsRaw, centre);
  const overture = await fetchOverture(centre, resolve(DATA_DIR, 'overture', `${centre.id}.geojson`), OVERTURE_LIMIT_MS, log);
  if (overture) log(`Overture: +${addOvertureBuildings(world, overture)} buildings OSM doesn't have`);

  log(stepLine(3));
  log(worldSummary(world));
  const scenery = buildScenery(sceneryRaw, roadsRaw, centre);
  log(scenerySummary(scenery));
  log(stepLine(4));
  const autos = autoRoutes(world);
  if (!autos.length) throw new Error(`no test route could be made around ${centre.name}`);

  mkdirSync(outDir, { recursive: true });
  // Clear old routes first, so a rebuild that makes fewer doesn't keep stale ones.
  for (const f of readdirSync(outDir)) if (/^route-.*\.json$/.test(f)) rmSync(resolve(outDir, f));
  for (const a of autos) {
    writeFileSync(resolve(outDir, `route-${a.route.id}.json`), JSON.stringify(a.route));
    log(`${a.route.id} · ${a.route.name}: ${Math.round(a.route.lengthM)} m · ${a.has.join(', ')}`);
  }
  writeFileSync(resolve(outDir, 'scenery.json'), JSON.stringify(scenery));
  // world.json last: the server counts a centre as built once it's there.
  writeFileSync(resolve(outDir, 'world.json'), JSON.stringify(world));
  return autos.map((a) => a.route.id);
}
