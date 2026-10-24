import * as THREE from 'three';
import { dashPieces, discTriangles, offsetPolyline, stripTriangles, stripUVs, type Circle } from './geometry';
import { areaOf, buildingsGroup, isShop } from './buildings';
import { surface } from './textures';
import type { Road, Vec2, WorldData } from './types';

// Builds the 3D world from assets/<centre>/world.json (SPEC §4.1): grass, pavements, roads,
// lane markings and buildings, each merged into one mesh.

export const PAVEMENT_M = 2;
const LINE_W = 0.12;
/** Kerb stones along roads with a pavement: how high they stand and how wide their top is. */
const KERB_H = 0.12;
const KERB_W = 0.15;
/** How far the paving reaches out from a shop's walls (it stops at the road, which draws on top). */
const SHOP_APRON_M = 14;
const NO_PAVEMENT = new Set(['service', 'motorway', 'motorway_link', 'trunk_link']);
/** Roads narrower than this (single-track, service) get no painted lines. */
const MIN_MARKED_WIDTH_M = 5;

// Flat layers sit on y = 0 and draw in this order without writing depth, so they never flicker
// against each other however far away they are. Anything solid (buildings, the car) draws after them.
export const LAYER = { ground: -4, pavement: -3, road: -2, marking: -1 } as const;

export const COLOURS = {
  grass: 0x5d8a46,
  pavement: 0xa9a59c,
  road: 0x45474b,
  marking: 0xf2f2ee,
};

/** Half the side of the square of grass (and of its collider), in metres. */
export const groundHalfM = (radiusM: number) => radiusM * 3;

export interface StartPose {
  x: number;
  z: number;
  /** Rotation about +Y; 0 faces +X (east). */
  heading: number;
}

/** `base` is where the centre's files are: /<id> for one that ships with the game, or the server's cache. */
export async function loadWorld(base: string): Promise<WorldData> {
  const res = await fetch(`${base}/world.json`);
  if (!res.ok) throw new Error(`world.json: HTTP ${res.status} (run tools/src/osm-import.ts)`);
  return res.json();
}

/** A world with nothing in it, used when world.json can't be loaded so the car can still drive. */
export function emptyWorld(centre: WorldData['centre']): WorldData {
  return { centre, generatedAt: '', roads: [], buildings: [], junctions: [], controls: [], graph: { nodes: [], edges: [] } };
}

const key = ([x, z]: Vec2) => `${x},${z}`;

export function buildWorld(data: WorldData, scene: THREE.Scene): StartPose {
  const group = new THREE.Group();
  group.name = 'world';
  scene.add(group);

  // Where roads meet or end, fill a disc as wide as the widest road there, so corners join up.
  const joins = new Map<string, { p: Vec2; half: number; count: number; pavement: boolean }>();
  for (const r of data.roads) {
    r.points.forEach((p, i) => {
      const k = key(p);
      const j = joins.get(k) ?? { p, half: 0, count: 0, pavement: false };
      j.half = Math.max(j.half, r.widthM / 2);
      j.count += i === 0 || i === r.points.length - 1 ? 2 : 1;
      j.pavement ||= hasPavement(r);
      joins.set(k, j);
    });
  }
  const discs = [...joins.values()].filter((j) => j.count >= 2);

  // Markings stop short of junctions where 3+ roads meet.
  const junctionGrid = new SpatialGrid(20);
  for (const j of data.junctions) if (j.degree >= 3) junctionGrid.add(j.pos, (joins.get(key(j.pos))?.half ?? 4) + 1);
  const holesNear = (a: Vec2, b: Vec2) => junctionGrid.near(a, b);

  // Kerbs stop where side roads come in: the gap covers the side road and its pavements.
  const mouthGrid = new SpatialGrid(20);
  for (const j of data.junctions) if (j.degree >= 3) mouthGrid.add(j.pos, (joins.get(key(j.pos))?.half ?? 4) + PAVEMENT_M + 1);

  const pavement: Vec2[] = [];
  const pavementUV: Vec2[] = [];
  const road: Vec2[] = [];
  const marks: Vec2[] = [];
  const kerbs: number[] = [];
  for (const r of data.roads) {
    const half = r.widthM / 2;
    if (hasPavement(r)) {
      for (const side of [-1, 1]) {
        const [a, b] = side < 0 ? [-half - PAVEMENT_M, -half] : [half, half + PAVEMENT_M];
        pavement.push(...stripTriangles(r.points, a, b));
        pavementUV.push(...stripUVs(r.points, a, b));
      }
      if (r.highway !== 'service') for (const piece of dashPieces(r.points, 1, 0, (a, b) => mouthGrid.near(a, b))) kerbs.push(...kerbPiece(piece, half));
    }
    road.push(...stripTriangles(r.points, -half, half));
    if (r.widthM >= MIN_MARKED_WIDTH_M && r.highway !== 'service') marks.push(...markings(r, holesNear));
  }
  // Shops on the high street stand on paving, not grass: a paved apron all round each one.
  for (const b of data.buildings) {
    if (!isShop(b) || b.footprint.length < 3) continue;
    // Run one point past the start so the first corner is mitred like the others.
    const ring = [...b.footprint, b.footprint[0], b.footprint[1]];
    const tris = areaOf(b.footprint) > 0 ? stripTriangles(ring, -SHOP_APRON_M, 0) : stripTriangles(ring, 0, SHOP_APRON_M);
    pavement.push(...tris);
    pavementUV.push(...tris);
  }
  for (const d of discs) {
    if (d.pavement) {
      const tris = discTriangles(d.p, d.half + PAVEMENT_M);
      pavement.push(...tris);
      pavementUV.push(...tris);
    }
    road.push(...discTriangles(d.p, d.half));
  }

  const flat = (name: string, sizeM: number, fallback: number, tint?: number) =>
    surface(name, sizeM, { fallback, tint, params: { depthWrite: false } });
  group.add(flatMesh(groundTriangles(groundHalfM(data.centre.radiusM)), flat('leafy_grass', 4, COLOURS.grass, 0xb8c8a0), LAYER.ground));
  group.add(flatMesh(pavement, flat('concrete_pavement', 2.4, COLOURS.pavement, 0xd8d4cc), LAYER.pavement, pavementUV));
  group.add(flatMesh(road, flat('asphalt_02', 6, COLOURS.road, 0x9a9a9a), LAYER.road));
  group.add(flatMesh(marks, COLOURS.marking, LAYER.marking));
  group.add(kerbMesh(kerbs));
  group.add(buildingsGroup(data.buildings));

  return startPose(data.roads);
}

function hasPavement(r: Road) {
  return !NO_PAVEMENT.has(r.highway);
}

/** Lane dividers (dashed; the centre line of a two-way road is the main one) and solid edge lines. */
function markings(r: Road, holesNear: (a: Vec2, b: Vec2) => Circle[]): Vec2[] {
  const half = r.widthM / 2;
  const laneW = r.widthM / r.lanes;
  const tris: Vec2[] = [];
  const line = (offset: number, dash: number, gap: number) => {
    for (const piece of dashPieces(r.points, dash, gap, holesNear)) {
      tris.push(...stripTriangles(piece, offset - LINE_W / 2, offset + LINE_W / 2));
    }
  };
  for (let k = 1; k < r.lanes; k++) {
    const offset = -half + k * laneW;
    const isCentre = !r.oneway && Math.abs(offset) < 0.01;
    line(offset, isCentre ? 4 : 2, isCentre ? 5 : 7);
  }
  line(-half + 0.3, 1, 0);
  line(half - 0.3, 1, 0);
  return tris;
}

/** Both kerbs of one stretch of road: a top and a face on each side, as flat x,y,z triangles. */
function kerbPiece(points: Vec2[], half: number): number[] {
  const out: number[] = [];
  for (const side of [-1, 1]) {
    const inner = side * half;
    const outer = side * (half + KERB_W);
    for (const [x, z] of stripTriangles(points, inner, outer)) out.push(x, KERB_H, z);
    // The face towards the road: the inner edge of the top, dropped to the ground.
    const edge = offsetPolyline(points, inner);
    for (let i = 0; i < edge.length - 1; i++) {
      const [a, b] = [edge[i], edge[i + 1]];
      out.push(a[0], 0, a[1], b[0], 0, b[1], a[0], KERB_H, a[1], a[0], KERB_H, a[1], b[0], 0, b[1], b[0], KERB_H, b[1]);
    }
  }
  return out;
}

function kerbMesh(kerbs: number[]): THREE.Mesh {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(kerbs, 3));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 0.95, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}

function groundTriangles(size: number): Vec2[] {
  return [
    [-size, -size],
    [-size, size],
    [size, -size],
    [size, -size],
    [-size, size],
    [size, size],
  ];
}

/**
 * One flat layer on the ground. `look` is a plain colour or a material; `uvs` (in metres, one per vertex
 * of `tris`) default to the world position, which suits textures with no direction like asphalt.
 */
export function flatMesh(tris: Vec2[], look: number | THREE.Material, renderOrder: number, uvs: Vec2[] = tris): THREE.Mesh {
  const pos = new Float32Array(tris.length * 3);
  const normal = new Float32Array(tris.length * 3);
  const uv = new Float32Array(tris.length * 2);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    // Wind every triangle to face up (+y), whichever way the shape helpers emitted it, so lighting is even.
    const upward = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
    (upward ? [0, 1, 2] : [0, 2, 1]).forEach((from, k) => {
      const i = t + k;
      pos[i * 3] = tris[t + from][0];
      pos[i * 3 + 2] = tris[t + from][1];
      normal[i * 3 + 1] = 1;
      uv[i * 2] = uvs[t + from][0];
      uv[i * 2 + 1] = uvs[t + from][1];
    });
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mat = typeof look === 'number' ? new THREE.MeshStandardMaterial({ color: look, roughness: 0.7, depthWrite: false }) : look;
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = renderOrder;
  mesh.receiveShadow = true;
  return mesh;
}

/** On the nearest main road to the centre (the test centre), facing along it. */
function startPose(roads: Road[]): StartPose {
  let best: StartPose = { x: 0, z: 0, heading: 0 };
  let bestD = Infinity;
  for (const r of roads) {
    if (r.highway === 'service' || r.highway.endsWith('_link')) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, az] = r.points[i];
      const [bx, bz] = r.points[i + 1];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const d = Math.hypot(mx, mz);
      if (d >= bestD) continue;
      bestD = d;
      const heading = Math.atan2(-(bz - az), bx - ax);
      // Drive on the left: sit in the left-hand lane of a two-way road (negative = left, see offsetPolyline).
      const offset = r.oneway ? 0 : -r.widthM / 4;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      best = { x: mx + ((az - bz) / len) * offset, z: mz + ((bx - ax) / len) * offset, heading };
    }
  }
  return best;
}

/** Circles bucketed on a grid, to find the ones near a line segment quickly. */
class SpatialGrid {
  private cells = new Map<string, Circle[]>();
  constructor(private size: number) {}
  add(p: Vec2, r: number) {
    const reach = Math.ceil(r / this.size);
    const cx = Math.floor(p[0] / this.size);
    const cz = Math.floor(p[1] / this.size);
    for (let i = -reach; i <= reach; i++)
      for (let j = -reach; j <= reach; j++) {
        const k = `${cx + i},${cz + j}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k)!.push({ c: p, r });
      }
  }
  /** Circles that could touch the segment a–b. */
  near(a: Vec2, b: Vec2): Circle[] {
    const found = new Set<Circle>();
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])].map((v) => Math.floor(v / this.size));
    const [z0, z1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])].map((v) => Math.floor(v / this.size));
    for (let i = x0; i <= x1; i++)
      for (let j = z0; j <= z1; j++) for (const c of this.cells.get(`${i},${j}`) ?? []) found.add(c);
    return [...found];
  }
}
