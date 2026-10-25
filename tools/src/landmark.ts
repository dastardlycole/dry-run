import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { headingOf, nearestOnPolyline, pointAlong, polylineLength } from '../../client/src/world/geometry';
import { makeProjection } from '../../client/src/world/projection';
import type { Landmark, Vec2, WorldData } from '../../client/src/world/types';
import { ASSETS_DIR } from './env';

// Puts a named place (the hackathon venue) into a built area: a sign on the front of its building, facing the
// street, and a free-drive start on that street with the building coming up on the left.
//   npm run landmark -w tools -- encode-hub "Encode Hub" 51.5275694 -0.0837896 "Pitfield Street"
// The folder is assets/<id> (or a path). Run it again after a rebuild: centre-build writes a fresh world.json.

const [where, name, lat, lng, street] = process.argv.slice(2);
if (!street) {
  console.error('usage: landmark <centre id or folder> <name> <lat> <lng> <street it faces>');
  process.exit(1);
}
/** How far back down the street the car starts, so the sign comes into view as it drives up. */
const START_BACK_M = 45;
const SIGN_W_M = 4.5;
/** Shop-sign height: above a ground-floor door, below the first-floor windows. */
const SIGN_Y_M = 3.2;

const dir = where.includes('/') || where.includes('\\') ? resolve(where) : resolve(ASSETS_DIR, where);
const file = resolve(dir, 'world.json');
const world: WorldData = JSON.parse(readFileSync(file, 'utf8'));
const at = makeProjection(world.centre.lat, world.centre.lng).toLocal(Number(lat), Number(lng));

const inside = ([x, z]: Vec2, ring: Vec2[]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
};
const building = world.buildings.find((b) => inside(at, b.footprint));
if (!building) throw new Error(`no building at ${lat}, ${lng}`);

const roads = world.roads.filter((r) => r.name === street);
if (!roads.length) throw new Error(`no road called ${street}`);
const nearestRoad = (p: Vec2) =>
  roads
    .map((r) => ({ r, ...nearestOnPolyline(r.points, p) }))
    .reduce((a, b) => (b.d < a.d ? b : a));

// The walls: footprint edges, with pieces in a straight line joined up (OSM often splits a front in two).
const ring = building.footprint;
const middle: Vec2 = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
const dirOf = (a: Vec2, b: Vec2) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const walls: { a: Vec2; b: Vec2 }[] = [];
for (let i = 0; i < ring.length; i++) {
  const a = ring[i];
  const b = ring[(i + 1) % ring.length];
  const last = walls[walls.length - 1];
  if (last && Math.abs(Math.sin(dirOf(last.a, last.b) - dirOf(a, b))) < 0.1 && Math.cos(dirOf(last.a, last.b) - dirOf(a, b)) > 0) last.b = b;
  else walls.push({ a, b });
}
// The front: the wall facing the street (its outward side towards the road), nearest to it.
let front: { mid: Vec2; normal: Vec2; lengthM: number; d: number } | null = null;
for (const { a, b } of walls) {
  const lengthM = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (lengthM < 2) continue;
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let normal: Vec2 = [-(b[1] - a[1]) / lengthM, (b[0] - a[0]) / lengthM];
  if ((mid[0] - middle[0]) * normal[0] + (mid[1] - middle[1]) * normal[1] < 0) normal = [-normal[0], -normal[1]];
  const near = nearestRoad(mid);
  const p = pointAlong(near.r.points, polylineLength(near.r.points.slice(0, near.k + 1)) + near.t * Math.hypot(near.r.points[near.k + 1][0] - near.r.points[near.k][0], near.r.points[near.k + 1][1] - near.r.points[near.k][1])).p;
  const toRoad: Vec2 = [(p[0] - mid[0]) / (near.d || 1), (p[1] - mid[1]) / (near.d || 1)];
  if (toRoad[0] * normal[0] + toRoad[1] * normal[1] < 0.7) continue;
  if (!front || near.d < front.d) front = { mid, normal, lengthM, d: near.d };
}
if (!front) throw new Error(`no wall of the building faces ${street}`);
const { normal } = front;
const signW = Math.min(SIGN_W_M, front.lengthM - 0.6);
const signPos: Vec2 = [front.mid[0] + normal[0] * 0.08, front.mid[1] + normal[1] * 0.08];

// The start: back down the street, in the left lane, driving towards the building with it on the left.
const { r: road, k, t } = nearestRoad(signPos);
const alongM = polylineLength(road.points.slice(0, k + 1)) + t * Math.hypot(road.points[k + 1][0] - road.points[k][0], road.points[k + 1][1] - road.points[k][1]);
const total = polylineLength(road.points);
const options = [1, -1].flatMap((way) => {
  const fromM = alongM - way * START_BACK_M;
  if (fromM < 0 || fromM > total || (road.oneway && way < 0)) return [];
  const { p, dir } = pointAlong(road.points, fromM);
  const forward: Vec2 = [dir[0] * way, dir[1] * way];
  // x = east, z = south: left of (dx, dz) is (dz, -dx).
  const left: Vec2 = [forward[1], -forward[0]];
  const onLeft = (signPos[0] - p[0]) * left[0] + (signPos[1] - p[1]) * left[1] > 0;
  const lane = road.oneway ? 0 : road.widthM / 4;
  return [{ onLeft, pos: [p[0] + left[0] * lane, p[1] + left[1] * lane] as Vec2, heading: headingOf(forward[0], forward[1]) }];
});
const start = options.find((o) => o.onLeft) ?? options[0];
if (!start) throw new Error(`no room on ${street} to start ${START_BACK_M} m back`);

const round = (v: number) => Math.round(v * 100) / 100;
const landmark: Landmark = {
  name,
  sign: { pos: [round(signPos[0]), round(signPos[1])], y: Math.min(SIGN_Y_M, building.heightM - 0.6), facing: round(Math.atan2(normal[0], normal[1])), widthM: round(signW) },
  start: { pos: [round(start.pos[0]), round(start.pos[1])], heading: round(start.heading) },
};
world.landmark = landmark;
writeFileSync(file, JSON.stringify(world));
console.log(`${name}: sign on the ${street} wall of a ${building.heightM} m building, start ${START_BACK_M} m back (${start.onLeft ? 'on the left' : 'on the right'})`, landmark);
