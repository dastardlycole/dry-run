import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Building, Road, Vec2, WorldData } from '../../../client/src/world/types';
import type { Centre } from './overpass';
import { bboxAround, makeProjection } from './project';

// Fills streets OSM hasn't mapped with Overture Maps building outlines (row 25): OSM plus outlines traced
// by AI from aerial photos (Microsoft, Google). OSM always wins: an Overture outline is only added where no
// OSM building stands, and never on or next to a road (buildings are solid, so one on a road blocks it).
// The download needs Overture's Python tool (`pip install overturemaps`); without it, the map is OSM only.

/** The parts of an Overture building feature (GeoJSON) we read. */
export interface OvertureFeature {
  geometry: { type: string; coordinates: unknown };
  properties: { sources?: { dataset?: string }[] | string; height?: number | null; num_floors?: number | null; is_underground?: boolean };
}

/** Clear space kept between a building and the kerb (on top of the pavement). */
export const ROAD_CLEAR_M = 1;
/** Outlines smaller than this are scraps (bins, AI noise). */
const MIN_AREA_M2 = 10;
/** Edges touching by less than this aren't an overlap: OSM and AI outlines of neighbours often touch. */
const TOUCH_M = 0.5;
/** AI heights can be wild; nothing round here is taller. */
const MAX_HEIGHT_M = 30;
const CELL_M = 40;

// As drawn in client/src/world/world.ts (not imported: it pulls in three.js).
const PAVEMENT_M = 2;
const NO_PAVEMENT = new Set(['service', 'motorway', 'motorway_link', 'trunk_link']);
const round = (v: number) => Math.round(v * 100) / 100;

const area = (ring: Vec2[]) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
};

const centroid = (ring: Vec2[]): Vec2 => {
  let x = 0;
  let z = 0;
  for (const p of ring) [x, z] = [x + p[0], z + p[1]];
  return [x / ring.length, z / ring.length];
};

const inside = ([x, z]: Vec2, ring: Vec2[]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
};

const pointSegDist = ([px, pz]: Vec2, [ax, az]: Vec2, [bx, bz]: Vec2) => {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const segsCross = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) =>
  cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;

const segSegDist = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) =>
  segsCross(a, b, c, d) ? 0 : Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));

const distToRing = (p: Vec2, ring: Vec2[]) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, pointSegDist(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
};

type Box = [minX: number, minZ: number, maxX: number, maxZ: number];
const boxOf = (pts: Vec2[], pad = 0): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of pts) [b[0], b[1], b[2], b[3]] = [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)];
  return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
};

/** A coarse grid so each outline is only tested against what's near it. */
class Grid<T> {
  private cells = new Map<string, T[]>();
  private *keys([x0, z0, x1, z1]: Box) {
    for (let i = Math.floor(x0 / CELL_M); i <= Math.floor(x1 / CELL_M); i++)
      for (let j = Math.floor(z0 / CELL_M); j <= Math.floor(z1 / CELL_M); j++) yield `${i},${j}`;
  }
  add(box: Box, item: T) {
    for (const k of this.keys(box)) {
      const list = this.cells.get(k);
      if (list) list.push(item);
      else this.cells.set(k, [item]);
    }
  }
  near(box: Box): Set<T> {
    const out = new Set<T>();
    for (const k of this.keys(box)) for (const item of this.cells.get(k) ?? []) out.add(item);
    return out;
  }
}

/** The two outlines share more than a touching edge. */
function overlaps(a: Vec2[], b: Vec2[]): boolean {
  if (inside(centroid(a), b) || inside(centroid(b), a)) return true;
  const deepIn = (p: Vec2, ring: Vec2[]) => inside(p, ring) && distToRing(p, ring) > TOUCH_M;
  return a.some((p) => deepIn(p, b)) || b.some((p) => deepIn(p, a));
}

interface RoadSeg {
  a: Vec2;
  b: Vec2;
  /** No building may come closer than this to the centre line. */
  clearM: number;
}

const roadClearM = (r: Road) => r.widthM / 2 + (NO_PAVEMENT.has(r.highway) ? 0 : PAVEMENT_M) + ROAD_CLEAR_M;

function nearRoad(ring: Vec2[], segs: Iterable<RoadSeg>): boolean {
  for (const s of segs) {
    if (inside(s.a, ring) || inside(s.b, ring)) return true;
    for (let i = 0; i < ring.length; i++) if (segSegDist(ring[i], ring[(i + 1) % ring.length], s.a, s.b) < s.clearM) return true;
  }
  return false;
}

/** Outer rings of a Polygon / MultiPolygon in [lng, lat], without the repeated closing point. */
function outerRings(g: OvertureFeature['geometry']): [number, number][][] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? (g.coordinates as unknown[]) : [];
  return (polys as [number, number][][][]).map((p) => p[0].slice(0, -1));
}

const fromOsm = (f: OvertureFeature) => {
  const s = typeof f.properties.sources === 'string' ? JSON.parse(f.properties.sources) : f.properties.sources ?? [];
  return (s as { dataset?: string }[]).some((x) => x.dataset === 'OpenStreetMap');
};

/** Height from Overture's height or floors, else our usual 7 m guess (as for an untagged OSM building). */
export function overtureHeightM(p: OvertureFeature['properties']): number {
  if (p.height && p.height > 0) return Math.round(Math.min(Math.max(p.height, 3), MAX_HEIGHT_M) * 10) / 10;
  if (p.num_floors && p.num_floors > 0) return Math.min(p.num_floors * 3 + 1, MAX_HEIGHT_M);
  return 7;
}

/**
 * Adds Overture outlines that OSM doesn't have to `world.buildings` (in place) and returns how many.
 * Any earlier Overture buildings are dropped first, so it can be run again on the same world.
 */
export function addOvertureBuildings(world: WorldData, features: OvertureFeature[]): number {
  const { centre } = world;
  const proj = makeProjection(centre.lat, centre.lng);
  world.buildings = world.buildings.filter((b) => b.from !== 'overture');

  const osm = new Grid<Vec2[]>();
  for (const b of world.buildings) osm.add(boxOf(b.footprint), b.footprint);
  const roads = new Grid<RoadSeg>();
  for (const r of world.roads) {
    const clearM = roadClearM(r);
    for (let i = 1; i < r.points.length; i++) roads.add(boxOf([r.points[i - 1], r.points[i]], clearM), { a: r.points[i - 1], b: r.points[i], clearM });
  }

  let added = 0;
  for (const f of features) {
    if (f.properties.is_underground || fromOsm(f)) continue;
    for (const lngLat of outerRings(f.geometry)) {
      const ring = lngLat.map(([lng, lat]) => proj.toLocal(lat, lng)).map(([x, z]): Vec2 => [round(x), round(z)]);
      if (ring.length < 3 || area(ring) < MIN_AREA_M2) continue;
      const [cx, cz] = centroid(ring);
      if (Math.abs(cx) > centre.radiusM || Math.abs(cz) > centre.radiusM) continue; // same box as the OSM buildings
      const box = boxOf(ring);
      if ([...osm.near(box)].some((o) => overlaps(ring, o))) continue;
      if (nearRoad(ring, roads.near(box))) continue;
      const building: Building = { heightM: overtureHeightM(f.properties), footprint: ring, from: 'overture' };
      world.buildings.push(building);
      osm.add(box, ring); // Overture's own outlines don't overlap, but keep it that way
      added++;
    }
  }
  return added;
}

/** Overture's download box for the centre: the same square as the OSM buildings, as west,south,east,north. */
export const overtureBbox = (c: Centre) => {
  const [s, w, n, e] = bboxAround(c.lat, c.lng, c.radiusM);
  return [w, s, e, n].map((v) => v.toFixed(5)).join(',');
};

/**
 * Downloads Overture buildings around the centre to `outFile` (GeoJSON) with the `overturemaps` tool
 * and returns its features, or null if the tool is missing, fails or takes longer than `limitMs`.
 * Never throws: the map is still fine with OSM buildings only.
 */
export async function fetchOverture(c: Centre, outFile: string, limitMs: number, log: (line: string) => void): Promise<OvertureFeature[] | null> {
  mkdirSync(dirname(outFile), { recursive: true });
  const part = `${outFile}.part`;
  rmSync(part, { force: true });
  const cmd = process.env.OVERTURE_CMD || 'overturemaps';
  const ok = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean, why?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (why) log(why);
      resolve(v);
    };
    // One command line through the shell, so Windows finds overturemaps.exe on the PATH.
    const args = ['download', `--bbox=${overtureBbox(c)}`, '-f', 'geojson', '--type=building', '-o', `"${part}"`];
    const child = spawn([cmd, ...args].join(' '), { stdio: 'ignore', shell: true });
    const timer = setTimeout(() => {
      done(false, `Overture download took over ${limitMs / 1000} s: OSM buildings only`);
      child.kill();
    }, limitMs);
    child.on('error', () => done(false, 'Overture tool not found (pip install overturemaps): OSM buildings only'));
    child.on('exit', (code) => done(code === 0, code === 0 ? undefined : `Overture download failed (exit ${code}): OSM buildings only`));
  });
  rmSync(`${part}.state`, { force: true });
  if (!ok || !existsSync(part)) return null;
  try {
    const features = JSON.parse(readFileSync(part, 'utf8')).features as OvertureFeature[];
    renameSync(part, outFile);
    return features;
  } catch {
    log('Overture download was unreadable: OSM buildings only');
    return null;
  }
}
