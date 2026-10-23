import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CENTRE } from '../../client/src/config';
import type { WorldData } from '../../client/src/world/types';
import { ASSETS_DIR } from './env';
import { buildRoute } from './route/build';
import { WANSTEAD_DEMO } from './routes/wanstead-demo';

// Builds assets/<centre>/route-demo.json from world.json (SPEC §4.4). Run after osm-import.
const dir = resolve(ASSETS_DIR, CENTRE.id);
const world = JSON.parse(readFileSync(resolve(dir, 'world.json'), 'utf8')) as WorldData;
const route = buildRoute(world, WANSTEAD_DEMO);

const out = resolve(dir, `route-${route.id}.json`);
writeFileSync(out, JSON.stringify(route));

for (const s of route.steps) {
  const what = s.action === 'roundabout' ? `exit ${s.exit} of ${s.exits}` : s.action;
  console.log(`${s.id.padEnd(4)} ${String(Math.round(s.atM)).padStart(5)} m  ${s.control.padEnd(10)} ${what.padEnd(12)} ${s.fromRoad} → ${s.toRoad}  (${s.turnDeg}°)`);
}
const has = (c: string) => route.steps.some((s) => s.control === c);
const minutes = route.lengthM / 9 / 60; // ~20 mph average with stops
console.log(`${route.name}: ${Math.round(route.lengthM)} m, ~${minutes.toFixed(1)} min · ${route.parkedCars.length} parked cars`);
for (const c of ['roundabout', 'signals', 'giveway']) if (!has(c)) console.warn(`WARNING: route has no ${c} junction (FR-R1)`);
console.log(`Saved ${out}`);
