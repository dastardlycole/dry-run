import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CENTRE } from '../../client/src/config';
import type { Route, WorldData } from '../../client/src/world/types';
import { ASSETS_DIR } from './env';
import { autoRoutes } from './route/auto';
import { buildRoute } from './route/build';
import { WANSTEAD_DEMO } from './routes/wanstead-demo';

// Builds assets/<centre>/route-demo.json and the generated route-auto-<n>.json from world.json
// (SPEC §4.4, §16.4). Run after osm-import.
const dir = resolve(ASSETS_DIR, CENTRE.id);
const world = JSON.parse(readFileSync(resolve(dir, 'world.json'), 'utf8')) as WorldData;

const save = (route: Route) => {
  const out = resolve(dir, `route-${route.id}.json`);
  writeFileSync(out, JSON.stringify(route));
  for (const s of route.steps) {
    const what = s.action === 'roundabout' ? `exit ${s.exit} of ${s.exits}` : s.action;
    console.log(`${s.id.padEnd(4)} ${String(Math.round(s.atM)).padStart(5)} m  ${s.control.padEnd(10)} ${what.padEnd(12)} ${s.fromRoad} → ${s.toRoad}  (${s.turnDeg}°)`);
  }
  const has = (c: string) => route.steps.some((s) => s.control === c);
  const minutes = route.lengthM / 9 / 60; // ~20 mph average with stops
  console.log(`${route.id} · ${route.name}: ${Math.round(route.lengthM)} m, ~${minutes.toFixed(1)} min · ${route.parkedCars.length} parked cars`);
  for (const c of ['roundabout', 'signals', 'giveway']) if (!has(c)) console.warn(`WARNING: route has no ${c} junction (FR-R1)`);
  console.log(`Saved ${out}\n`);
};

save(buildRoute(world, WANSTEAD_DEMO));
// Old generated routes go first, so a map that now makes fewer routes doesn't keep stale ones.
for (const f of readdirSync(dir)) if (/^route-auto-\d+\.json$/.test(f)) rmSync(resolve(dir, f));
// Generated loops start where the demo does: outside the test centre.
const autos = autoRoutes(world, { start: WANSTEAD_DEMO.waypoints[0] });
for (const a of autos) save(a.route);
if (autos.length < 3) console.warn(`WARNING: only ${autos.length} generated routes (want 3+)`);
