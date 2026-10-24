import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { flatMesh, LAYER, PAVEMENT_M } from './world';
import { surface } from './textures';
import type { GreenKind, SceneryData, Vec2, WorldData } from './types';

// Parks, woods, water and trees (SPEC §4.1, looks only). Areas are flat layers between the grass and the
// pavements. Trees are a few generated shapes (ez-tree) drawn many times: full detail near the camera,
// a lighter version further out, none past the haze.

export async function loadScenery(centreId: string): Promise<SceneryData> {
  const res = await fetch(`/${centreId}/scenery.json`);
  if (!res.ok) throw new Error(`scenery.json: HTTP ${res.status} (run npm run scenery -w tools)`);
  return res.json();
}

/** Draw order of each kind of area: woods over parks, water over both, all under the pavements. */
const AREA_LAYER: Record<GreenKind, number> = {
  grass: LAYER.ground + 0.2,
  park: LAYER.ground + 0.3,
  pitch: LAYER.ground + 0.4,
  scrub: LAYER.ground + 0.5,
  wood: LAYER.ground + 0.6,
  water: LAYER.ground + 0.8,
};

export function greenAreas(data: SceneryData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'green';
  const tris: Record<GreenKind, Vec2[]> = { grass: [], park: [], pitch: [], scrub: [], wood: [], water: [] };
  for (const a of data.areas) {
    const pts = a.ring.map(([x, z]) => new THREE.Vector2(x, z));
    for (const t of THREE.ShapeUtils.triangulateShape(pts, [])) tris[a.kind].push(...t.map((i) => a.ring[i]));
  }
  const flat = { depthWrite: false };
  const looks: Record<GreenKind, THREE.Material> = {
    grass: surface('leafy_grass', 4, { fallback: 0x6a9a4e, tint: 0xc0d8a0, params: flat }),
    park: surface('leafy_grass', 4, { fallback: 0x5f9446, tint: 0xb0d890, params: flat }),
    pitch: surface('leafy_grass', 6, { fallback: 0x6aa84c, tint: 0xc8f0a0, normalScale: 0.3, params: flat }),
    scrub: surface('leafy_grass', 3, { fallback: 0x56703a, tint: 0x90a070, params: flat }),
    wood: surface('leafy_grass', 3, { fallback: 0x3f5a2c, tint: 0x6f7f50, params: flat }),
    water: new THREE.MeshStandardMaterial({ color: 0x3a5058, roughness: 0.05, metalness: 0.4, depthWrite: false }),
  };
  for (const kind of Object.keys(tris) as GreenKind[]) {
    if (tris[kind].length) group.add(flatMesh(tris[kind], looks[kind], AREA_LAYER[kind]));
  }
  return group;
}

/** Seeded random numbers, so trees land in the same places on every load. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function insideRing([x, z]: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Things bucketed on a grid by their bounding box, to find what's near a point quickly. */
export class BoxGrid<T> {
  private cells = new Map<string, T[]>();
  constructor(private size: number) {}
  add(item: T, x0: number, z0: number, x1: number, z1: number) {
    for (let i = Math.floor(x0 / this.size); i <= Math.floor(x1 / this.size); i++)
      for (let j = Math.floor(z0 / this.size); j <= Math.floor(z1 / this.size); j++) {
        const k = `${i},${j}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k)!.push(item);
      }
  }
  at([x, z]: Vec2): T[] {
    return this.cells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`) ?? [];
  }
}

export interface TreeSpot {
  x: number;
  z: number;
  /** Which tree shape (index into the generated variants). */
  variant: number;
  heightM: number;
  rot: number;
}

/** Roads that get street trees along their pavements. */
const TREE_LINED = new Set(['residential', 'tertiary', 'secondary', 'unclassified', 'living_street']);
const STREET_TREE_GAP_M = 14;
const MAX_TREES = 12000;

/**
 * Where trees stand: every tree OSM maps, along tree rows, scattered through woods and parks, and street
 * trees on the pavements of residential roads. None on a road, in a building or right at a junction.
 */
export function placeTrees(world: WorldData, scenery: SceneryData, variants: number): TreeSpot[] {
  const rand = rng(1234);
  const roadGrid = new BoxGrid<{ a: Vec2; b: Vec2; half: number }>(25);
  for (const r of world.roads)
    for (let i = 0; i < r.points.length - 1; i++) {
      const [a, b] = [r.points[i], r.points[i + 1]];
      const half = r.widthM / 2 + 0.5;
      roadGrid.add({ a, b, half }, Math.min(a[0], b[0]) - half, Math.min(a[1], b[1]) - half, Math.max(a[0], b[0]) + half, Math.max(a[1], b[1]) + half);
    }
  const buildingGrid = new BoxGrid<Vec2[]>(25);
  for (const b of world.buildings) {
    const xs = b.footprint.map((p) => p[0]);
    const zs = b.footprint.map((p) => p[1]);
    buildingGrid.add(b.footprint, Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2);
  }
  const junctionGrid = new BoxGrid<Vec2>(25);
  for (const j of world.junctions) if (j.degree >= 3) junctionGrid.add(j.pos, j.pos[0] - 12, j.pos[1] - 12, j.pos[0] + 12, j.pos[1] + 12);

  const onRoad = (p: Vec2) => roadGrid.at(p).some(({ a, b, half }) => distToSegment(p, a, b) < half);
  const inBuilding = (p: Vec2) => buildingGrid.at(p).some((ring) => insideRing(p, ring) || nearRing(p, ring, 1.5));
  const atJunction = (p: Vec2) => junctionGrid.at(p).some((j) => Math.hypot(p[0] - j[0], p[1] - j[1]) < 12);

  const spots: TreeSpot[] = [];
  const add = (p: Vec2, minH: number, maxH: number) => {
    if (spots.length >= MAX_TREES || onRoad(p) || inBuilding(p)) return;
    spots.push({ x: p[0], z: p[1], variant: Math.floor(rand() * variants), heightM: minH + rand() * (maxH - minH), rot: rand() * Math.PI * 2 });
  };

  for (const t of scenery.trees) add(t, 9, 15);
  for (const row of scenery.treeRows) for (const p of along(row, 9)) add(p, 9, 14);
  // Scatter: woods are dense, parks have a tree here and there.
  for (const a of scenery.areas) {
    const spacing = a.kind === 'wood' ? 8 : a.kind === 'scrub' ? 14 : a.kind === 'park' ? 28 : 0;
    if (!spacing) continue;
    const keep = a.kind === 'park' ? 0.45 : 0.9;
    const xs = a.ring.map((p) => p[0]);
    const zs = a.ring.map((p) => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += spacing)
      for (let z = Math.min(...zs); z < Math.max(...zs); z += spacing) {
        const p: Vec2 = [x + (rand() - 0.5) * spacing * 0.8, z + (rand() - 0.5) * spacing * 0.8];
        if (rand() < keep && insideRing(p, a.ring)) add(p, a.kind === 'wood' ? 12 : 8, a.kind === 'wood' ? 19 : 15);
      }
  }
  // Street trees in the outer half of the pavement, both sides, with gaps.
  for (const r of world.roads) {
    if (!TREE_LINED.has(r.highway)) continue;
    for (const side of [-1, 1])
      for (const p of along(offsetLine(r.points, side * (r.widthM / 2 + PAVEMENT_M - 0.5)), STREET_TREE_GAP_M)) {
        if (rand() < 0.6 && !atJunction(p)) add(p, 8, 13);
      }
  }
  return spots;
}

export function distToSegment([px, pz]: Vec2, [ax, az]: Vec2, [bx, bz]: Vec2): number {
  const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / len2)) : 0;
  return Math.hypot(px - ax - t * (bx - ax), pz - az - t * (bz - az));
}

export function nearRing(p: Vec2, ring: Vec2[], d: number): boolean {
  for (let i = 0; i < ring.length; i++) if (distToSegment(p, ring[i], ring[(i + 1) % ring.length]) < d) return true;
  return false;
}

/** Points every `gap` metres along a polyline, starting half a gap in. */
export function along(points: Vec2[], gap: number): Vec2[] {
  const out: Vec2[] = [];
  let next = gap / 2;
  let travelled = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    while (next <= travelled + len) {
      const t = (next - travelled) / len;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      next += gap;
    }
    travelled += len;
  }
  return out;
}

/** The polyline shifted sideways, without miters (good enough for placing things beside a road). */
export function offsetLine(points: Vec2[], offset: number): Vec2[] {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / len) * offset, p[1] + ((b[0] - a[0]) / len) * offset];
  });
}

/** Tree shapes: ez-tree presets, each with a seed so no two look alike. */
const SHAPES = [
  { preset: 'Oak Medium', seed: 11 },
  { preset: 'Ash Medium', seed: 23 },
  { preset: 'Oak Large', seed: 37 },
  { preset: 'Aspen Medium', seed: 41 },
  { preset: 'Oak Medium', seed: 59 },
];
export const TREE_SHAPES = SHAPES.length;
/** Full detail closer than this; a flat cut-out out to FAR_M; nothing beyond (it's in the haze). */
const NEAR_M = 120;
const FAR_M = 900;
/** Re-sort trees into near and far after the camera moves this far. */
const RESORT_M = 10;
/** Size of each tree's cut-out picture, in pixels. */
const IMPOSTOR_PX = 256;

interface Shape {
  /** Height of the generated tree, to scale it to a real height. */
  height: number;
  near: [THREE.InstancedMesh, THREE.InstancedMesh];
  far: THREE.InstancedMesh;
}

/**
 * Every tree in the world. Near the camera each one is the full ez-tree model; further out it's a
 * cut-out: a picture of the same tree, taken once at load, on two crossed cards (4 triangles).
 */
export class Trees {
  readonly group = new THREE.Group();
  private shapes: Shape[] = [];
  private last = new THREE.Vector3(Infinity, 0, Infinity);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  /** Builds the tree shapes, waiting for ez-tree's bark and leaf pictures so the cut-outs aren't blank. */
  static async create(spots: TreeSpot[], renderer: THREE.WebGLRenderer): Promise<Trees> {
    const trees = SHAPES.map(({ preset, seed }) => makeTree(preset, seed));
    const maps = trees.flatMap((t) => [t.branchesMesh.material, t.leavesMesh.material]).flatMap((m) => (m as THREE.MeshPhongMaterial).map ?? []);
    for (let tries = 0; tries < 100 && maps.some((t) => !(t.image as HTMLImageElement | undefined)?.width); tries++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return new Trees(spots, trees, renderer);
  }

  private constructor(private spots: TreeSpot[], trees: Tree[], renderer: THREE.WebGLRenderer) {
    this.group.name = 'trees';
    const perShape = SHAPES.map((_, i) => spots.filter((t) => t.variant === i).length);
    trees.forEach((tree, i) => {
      const bark = barkMaterial(tree.branchesMesh.material);
      const leaves = leafMaterial(tree.leavesMesh.material);
      const height = Math.max(new THREE.Box3().setFromObject(tree).max.y, 1);
      const instanced = (geom: THREE.BufferGeometry, mat: THREE.Material, castShadow: boolean) => {
        const mesh = new THREE.InstancedMesh(geom, mat, perShape[i]);
        mesh.count = 0;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return mesh;
      };
      const cut = impostor(tree, bark, leaves, renderer);
      this.shapes.push({
        height,
        near: [instanced(tree.branchesMesh.geometry, bark, true), instanced(tree.leavesMesh.geometry, leaves, true)],
        far: instanced(cut.geometry, cut.material, false),
      });
    });
  }

  /** Put each tree in the near or far set (or neither) for a camera at `cam`. Cheap unless the camera moved. */
  update(cam: THREE.Vector3) {
    if (Math.hypot(cam.x - this.last.x, cam.z - this.last.z) < RESORT_M) return;
    this.last.copy(cam);
    const all = this.shapes.flatMap((sh) => [...sh.near, sh.far]);
    for (const mesh of all) mesh.count = 0;
    for (const t of this.spots) {
      const d = Math.hypot(t.x - cam.x, t.z - cam.z);
      if (d > FAR_M) continue;
      const sh = this.shapes[t.variant];
      this.m.compose(this.p.set(t.x, 0, t.z), this.q.setFromAxisAngle(this.up, t.rot), this.s.setScalar(t.heightM / sh.height));
      for (const mesh of d < NEAR_M ? sh.near : [sh.far]) mesh.setMatrixAt(mesh.count++, this.m);
    }
    for (const mesh of all) mesh.instanceMatrix.needsUpdate = true;
  }
}

function makeTree(preset: string, seed: number): Tree {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  // The presets are sparse for a street of mature London trees: more and bigger leaves.
  tree.options.leaves.count = Math.round(tree.options.leaves.count * 1.6);
  tree.options.leaves.size *= 1.4;
  tree.generate();
  return tree;
}

/** A picture of the tree from the side, on two crossed cards standing on the ground. */
function impostor(tree: Tree, bark: THREE.Material, leaves: THREE.Material, renderer: THREE.WebGLRenderer) {
  const box = new THREE.Box3().setFromObject(tree);
  const halfW = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
  const h = box.max.y;
  const rt = new THREE.WebGLRenderTarget(IMPOSTOR_PX, Math.round((IMPOSTOR_PX * h) / (2 * halfW)), {
    minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: true,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(tree.branchesMesh.geometry, bark), new THREE.Mesh(tree.leavesMesh.geometry, leaves));
  scene.add(new THREE.HemisphereLight(0xdde8f5, 0x5a5348, 1.3));
  const sun = new THREE.DirectionalLight(0xfff4e5, 2.0);
  sun.position.set(-1, 2, 2);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-halfW, halfW, h, 0, 0.1, halfW * 4);
  cam.position.set(0, 0, halfW * 2);
  const clear = renderer.getClearColor(new THREE.Color());
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  renderer.setClearColor(clear, alpha);

  const card = new THREE.PlaneGeometry(halfW * 2, h).translate(0, h / 2, 0);
  const geometry = mergeGeometries([card, card.clone().rotateY(Math.PI / 2)])!;
  const material = new THREE.MeshBasicMaterial({ map: rt.texture, alphaTest: 0.5, side: THREE.DoubleSide });
  return { geometry, material };
}

/** ez-tree's own materials sway in the wind, but that shader ignores instancing, so use plain ones. */
function barkMaterial(m: THREE.Material | THREE.Material[]): THREE.Material {
  const src = (Array.isArray(m) ? m[0] : m) as THREE.MeshPhongMaterial;
  return new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, color: src.color, roughness: 0.95 });
}

function leafMaterial(m: THREE.Material | THREE.Material[]): THREE.Material {
  const src = (Array.isArray(m) ? m[0] : m) as THREE.MeshPhongMaterial;
  return new THREE.MeshStandardMaterial({ map: src.map, color: src.color, alphaTest: src.alphaTest, side: THREE.DoubleSide, roughness: 0.85 });
}
