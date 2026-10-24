import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorldData } from '../../../client/src/world/types';
import { importWorld, worldSummary } from '../osm/import';
import { overpass, roadsQuery, sceneryQuery, type Centre } from '../osm/overpass';
import { autoRoutes } from '../route/auto';
import { buildScenery, scenerySummary } from '../scenery/build';
import type { CentreInfo } from './finder';

// Everything the sim needs for one test centre, with no hand work (SPEC §16, row 22): download the roads
// and scenery from OSM, build world.json and scenery.json, and make test routes from the road graph.
// Used by `npm run centre-build -w tools` and by the server when a learner types a new centre.

/** How far the map reaches from the centre, as at Wanstead. */
export const CENTRE_RADIUS_M = 1000;

export const toCentre = (c: CentreInfo): Centre => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, radiusM: CENTRE_RADIUS_M });

/** Builds the centre into `outDir` and returns the route ids made. Throws if no route could be made. */
export async function buildCentre(info: CentreInfo, outDir: string, log: (line: string) => void = console.log): Promise<string[]> {
  const centre = toCentre(info);
  log(`Downloading roads around ${centre.name}…`);
  const roadsRaw = JSON.parse(await overpass(roadsQuery(centre)));
  log('Downloading parks and trees…');
  const sceneryRaw = JSON.parse(await overpass(sceneryQuery(centre)));

  const world: WorldData = importWorld(roadsRaw, centre);
  log(worldSummary(world));
  const scenery = buildScenery(sceneryRaw, roadsRaw, centre);
  log(scenerySummary(scenery));
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
