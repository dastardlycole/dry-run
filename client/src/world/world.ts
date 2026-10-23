import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dashPieces, discTriangles, stripTriangles, type Circle } from './geometry';
import type { Road, Vec2, WorldData } from './types';

// Builds the 3D world from assets/<centre>/world.json (SPEC §4.1): grass, pavements, roads,
// lane markings and buildings, each merged into one mesh.

const PAVEMENT_M = 2;
const LINE_W = 0.12;
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
  buildings: [0xc9b79c, 0xb5a48a, 0xd8cdb8, 0x9e7f6a, 0xbfb6aa, 0xa8604c],
};

/** Half the side of the square of grass (and of its collider), in metres. */
export const groundHalfM = (radiusM: number) => radiusM * 3;

export interface StartPose {
  x: number;
  z: number;
  /** Rotation about +Y; 0 faces +X (east). */
  heading: number;
}

export async function loadWorld(centreId: string): Promise<WorldData> {
  const res = await fetch(`/${centreId}/world.json`);
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

  const pavement: Vec2[] = [];
  const road: Vec2[] = [];
  const marks: Vec2[] = [];
  for (const r of data.roads) {
    const half = r.widthM / 2;
    if (hasPavement(r)) pavement.push(...stripTriangles(r.points, -half - PAVEMENT_M, half + PAVEMENT_M));
    road.push(...stripTriangles(r.points, -half, half));
    if (r.widthM >= MIN_MARKED_WIDTH_M && r.highway !== 'service') marks.push(...markings(r, holesNear));
  }
  for (const d of discs) {
    if (d.pavement) pavement.push(...discTriangles(d.p, d.half + PAVEMENT_M));
    road.push(...discTriangles(d.p, d.half));
  }

  group.add(flatMesh(groundTriangles(groundHalfM(data.centre.radiusM)), COLOURS.grass, LAYER.ground));
  group.add(flatMesh(pavement, COLOURS.pavement, LAYER.pavement));
  group.add(flatMesh(road, COLOURS.road, LAYER.road));
  group.add(flatMesh(marks, COLOURS.marking, LAYER.marking));
  const buildings = buildingsMesh(data);
  if (buildings) group.add(buildings);

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

export function flatMesh(tris: Vec2[], colour: number, renderOrder: number): THREE.Mesh {
  const pos = new Float32Array(tris.length * 3);
  const normal = new Float32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    // Wind every triangle to face up (+y), whichever way the shape helpers emitted it, so lighting is even.
    const upward = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
    (upward ? [a, b, c] : [a, c, b]).forEach(([x, z], k) => {
      const i = t + k;
      pos[i * 3] = x;
      pos[i * 3 + 2] = z;
      normal[i * 3 + 1] = 1;
    });
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  const mat = new THREE.MeshLambertMaterial({ color: colour, depthWrite: false });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = renderOrder;
  return mesh;
}

function buildingsMesh(data: WorldData): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  const colour = new THREE.Color();
  data.buildings.forEach((b, i) => {
    // Shape is in the XY plane; after rotating -90° about X, shape y becomes world -z and depth becomes height.
    const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geom = new THREE.ExtrudeGeometry(shape, { depth: b.heightM, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    colour.setHex(COLOURS.buildings[i % COLOURS.buildings.length]);
    const n = geom.getAttribute('position').count;
    const colours = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) colour.toArray(colours, v * 3);
    geom.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geom.deleteAttribute('uv');
    parts.push(geom);
  });
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  if (!merged) return null;
  return new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
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
