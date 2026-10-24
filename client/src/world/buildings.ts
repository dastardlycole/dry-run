import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface } from './textures';
import type { Building, Vec2 } from './types';

// Buildings that read as Wanstead: two-storey brick houses and terraces with hipped slate or tile roofs,
// flats and shops with more floors, shop fronts on the high street. Windows are drawn by the wall shader
// (white frames, glass that reflects the sky), so they cost no geometry. Shapes and sizes come from OSM;
// what OSM doesn't say (floors, materials) is a stable guess per building.

export type Wall = 'redBrick' | 'yellowBrick' | 'render';
export type RoofKind = 'hip' | 'flat';
/** How the wall shader dresses a wall: windows on every floor, a shop front below windows, or nothing. */
export const MODE = { windows: 0, shop: 1, blank: 2 } as const;

export interface Style {
  floors: number;
  floorH: number;
  /** Height of the top of the walls. */
  eaveM: number;
  roof: RoofKind;
  wall: Wall;
  roofLook: 'slate' | 'tile';
  mode: number;
}

const HOUSES = new Set(['house', 'terrace', 'semidetached_house', 'detached', 'bungalow']);
const FLATS = new Set(['apartments', 'residential', 'dormitory']);
const SHOPS = new Set(['retail', 'commercial', 'supermarket', 'kiosk']);
const SMALL = new Set(['garage', 'garages', 'shed', 'hut', 'carport', 'roof', 'service', 'air_shaft', 'toilets']);
/** A hipped roof only goes on outlines that fill most of their bounding box, so it can't overhang gardens. */
const MIN_FILL_FOR_PITCH = 0.8;
/** Roof slope, and the most a ridge can rise above the walls. */
const PITCH = Math.tan(THREE.MathUtils.degToRad(35));
const MAX_RIDGE_M = 3.4;
const EAVES_OVERHANG_M = 0.3;

/** A number in [0, 1) that's the same for the same building every time. */
export function hashOf(footprint: Vec2[]): number {
  let h = 2166136261;
  for (const [x, z] of footprint.slice(0, 4)) {
    h = Math.imul(h ^ Math.round(x * 10), 16777619);
    h = Math.imul(h ^ Math.round(z * 10), 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

export function areaOf(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** The smallest box around the outline whose sides follow one of its edges. `u` is the long axis. */
export interface Box {
  c: Vec2;
  u: Vec2;
  /** Half length along u, half width across it (halfL >= halfW). */
  halfL: number;
  halfW: number;
  /** How much of the box the outline covers, 0..1. */
  fill: number;
}

export function boxOf(ring: Vec2[]): Box {
  let best: Box | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of ring) {
      const s = x * ux + z * uz;
      const t = -x * uz + z * ux;
      s0 = Math.min(s0, s); s1 = Math.max(s1, s);
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (area >= bestArea) continue;
    bestArea = area;
    const [sm, tm] = [(s0 + s1) / 2, (t0 + t1) / 2];
    const c: Vec2 = [sm * ux - tm * uz, sm * uz + tm * ux];
    const [hs, ht] = [(s1 - s0) / 2, (t1 - t0) / 2];
    best = hs >= ht ? { c, u: [ux, uz], halfL: hs, halfW: ht, fill: 0 } : { c, u: [-uz, ux], halfL: ht, halfW: hs, fill: 0 };
  }
  if (!best) return { c: ring[0], u: [1, 0], halfL: 0, halfW: 0, fill: 0 };
  best.fill = bestArea > 0 ? Math.abs(areaOf(ring)) / bestArea : 0;
  return best;
}

export const isShop = (b: Building) => !!b.shop || SHOPS.has(b.kind ?? '');

/** How a building is drawn: floors, roof and walls, from its OSM tags, size and a stable random pick. */
export function styleOf(b: Building, box: Box = boxOf(b.footprint)): Style {
  const kind = b.kind ?? 'yes';
  const area = Math.abs(areaOf(b.footprint));
  const h = hashOf(b.footprint);
  /** Height came from a real height or levels tag, not the importer's 7 m (or 3 m) guess. */
  const tagged = b.levels !== undefined || (b.heightM !== 7 && b.heightM !== 3);
  const pitchable = box.fill >= MIN_FILL_FOR_PITCH && box.halfW > 2 && box.halfW < 9;

  if (SMALL.has(kind) || (area < 30 && !tagged)) {
    return { floors: 1, floorH: 2.6, eaveM: 2.6, roof: 'flat', wall: 'render', roofLook: 'slate', mode: MODE.blank };
  }
  const shop = isShop(b);
  const flats = FLATS.has(kind) || (kind === 'yes' && area > 450);
  let floors = b.levels ?? (tagged ? Math.max(1, Math.round((b.heightM - 1) / 3)) : flats ? 3 : shop ? 3 : 2);
  floors = Math.min(floors, 20);
  const floorH = shop ? 3.2 : 2.9;
  const eaveM = floors * floorH + 0.3;
  const big = area > 600 || floors > 4;
  const roof: RoofKind = pitchable && !big ? 'hip' : 'flat';
  // Wanstead is mostly red and yellow (London stock) brick, with some white render.
  const wall: Wall = HOUSES.has(kind) || kind === 'yes' ? (h < 0.45 ? 'redBrick' : h < 0.8 ? 'yellowBrick' : 'render') : h < 0.6 ? 'redBrick' : 'yellowBrick';
  return { floors, floorH, eaveM, roof, wall, roofLook: h * 7 % 1 < 0.6 ? 'slate' : 'tile', mode: shop ? MODE.shop : MODE.windows };
}

/** Walls of one building as flat triangles with outward normals, wall UVs in metres, and the wall attribute. */
function wallGeometry(ring: Vec2[], s: Style): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const info: number[] = [];
  // areaOf > 0 means clockwise seen from above (x east, z south), where outward is left of travel.
  const sign = areaOf(ring) > 0 ? 1 : -1;
  let along = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = (sign * (bz - az)) / len;
    const nz = (sign * -(bx - ax)) / len;
    const top = s.eaveM;
    const quad: [number, number, number, number][] = [
      [ax, 0, az, 0], [bx, 0, bz, len], [bx, top, bz, len],
      [ax, 0, az, 0], [bx, top, bz, len], [ax, top, az, 0],
    ];
    // Wind so the face points outward.
    const order = sign > 0 ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
    for (const k of order) {
      const [x, y, z, w] = quad[k];
      pos.push(x, y, z);
      nor.push(nx, 0, nz);
      uv.push(along + w, y);
      info.push(w, len, s.mode, s.floorH);
    }
    along += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('wallInfo', new THREE.Float32BufferAttribute(info, 4));
  return g;
}

/** A hipped roof over the box, overhanging the walls a little. UVs run along the slope in metres. */
export function hipRoof(box: Box, eaveM: number): THREE.BufferGeometry {
  const L = box.halfL + EAVES_OVERHANG_M;
  const W = box.halfW + EAVES_OVERHANG_M;
  const rise = Math.min(W * PITCH, MAX_RIDGE_M);
  const ridge = Math.max(0, L - W);
  const [ux, uz] = box.u;
  const at = (s: number, t: number, y: number) => new THREE.Vector3(box.c[0] + s * ux - t * uz, y, box.c[1] + s * uz + t * ux);
  const e = eaveM - 0.15;
  const c = [at(-L, -W, e), at(L, -W, e), at(L, W, e), at(-L, W, e)];
  const r = [at(-ridge, 0, e + rise), at(ridge, 0, e + rise)];
  const faces = [
    [c[0], c[1], r[1], r[0]],
    [c[2], c[3], r[0], r[1]],
    [c[1], c[2], r[1]],
    [c[3], c[0], r[0]],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const slope = Math.hypot(W, rise);
  for (const f of faces) {
    // Wound so each face points up and out.
    const tris = f.length === 4 ? [f[0], f[2], f[1], f[0], f[3], f[2]] : [f[0], f[2], f[1]];
    const edge = new THREE.Vector3().subVectors(f[1], f[0]).normalize();
    for (const p of tris) {
      pos.push(p.x, p.y, p.z);
      const d = new THREE.Vector3().subVectors(p, f[0]);
      uv.push(d.dot(edge), ((p.y - e) / Math.max(rise, 0.01)) * slope);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** The outline filled in at the top of the walls. */
function flatRoof(ring: Vec2[], eaveM: number): THREE.BufferGeometry | null {
  const pts = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  if (!tris.length) return null;
  const pos: number[] = [];
  for (const t of tris) {
    // Wind each triangle to face up.
    const [a, b, c] = t.map((i) => ring[i]);
    const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
    for (const p of up ? [a, b, c] : [a, c, b]) pos.push(p[0], eaveM, p[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((v, i) => (i % 3 === 1 ? [] : [v])), 2));
  return g;
}

/**
 * The wall shader: brick or render from the texture, with a window grid on each floor (white frame, glass
 * that reflects the sky), and on shops a glazed shop front with a dark fascia instead of the ground floor.
 */
function withWindows(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 wallInfo;\nvarying vec4 vWall;\nvarying float vHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = wallInfo;\nvHeight = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWall;\nvarying float vHeight;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float glass = 0.0;
        {
          float s = vWall.x, len = vWall.y, mode = vWall.z, floorH = vWall.w;
          float frame = 0.0;
          vec3 tint = vec3(0.07, 0.09, 0.12);
          float fy = mod(vHeight, floorH);
          float floorIx = floor(vHeight / floorH);
          bool shopFloor = mode > 0.5 && mode < 1.5 && floorIx < 0.5;
          if (mode < 1.5 && len > 1.6 && s > 0.35 && s < len - 0.35) {
            if (shopFloor) {
              // Shop front: glass from knee height to 2.7 m with mullions every 1.6 m, a fascia above.
              if (vHeight > 0.35 && vHeight < 2.7) {
                float m = abs(mod(s, 1.6) - 0.8);
                if (m > 0.74 || vHeight < 0.45 || vHeight > 2.6) frame = 1.0; else glass = 1.0;
              } else if (vHeight >= 2.7 && vHeight < floorH) {
                diffuseColor.rgb = vec3(0.09, 0.11, 0.14);
              }
            } else {
              float n = max(1.0, floor(len / 2.7));
              float bay = len / n;
              float x = abs(mod(s, bay) - bay * 0.5);
              float halfW = min(0.6, bay * 0.3);
              // Each window gets its own shade of glass, and some have curtains drawn at the sides.
              float pick = fract(sin(dot(vec3(floor(s / bay), floorIx, len), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
              tint = mix(vec3(0.04, 0.05, 0.07), vec3(0.17, 0.20, 0.24), fract(pick * 7.0));
              if (x < halfW && fy > 0.85 && fy < 2.25) {
                if (x > halfW - 0.07 || fy < 0.92 || fy > 2.18 || abs(fy - 1.75) < 0.03) frame = 1.0;
                else if (pick > 0.65 && x > halfW * 0.6) diffuseColor.rgb = mix(vec3(0.78, 0.72, 0.6), vec3(0.55, 0.35, 0.3), fract(pick * 13.0));
                else glass = 1.0;
              } else if (x < halfW + 0.08 && fy > 0.76 && fy <= 0.85) {
                diffuseColor.rgb = vec3(0.8, 0.78, 0.74); // stone sill
              }
            }
          }
          if (frame > 0.5) diffuseColor.rgb = vec3(0.88, 0.88, 0.86);
          if (glass > 0.5) diffuseColor.rgb = tint;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.08, glass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, glass);')
      // Glass is flat: don't let the brick normal map ripple it.
      .replace('#include <normal_fragment_maps>', 'if (glass < 0.5) {\n#include <normal_fragment_maps>\n}');
  };
  return mat;
}

const WALL_LOOK: Record<Wall, () => THREE.MeshStandardMaterial> = {
  redBrick: () => surface('red_brick', 2.2, { fallback: 0x9a5a48, normalScale: 0.8 }),
  yellowBrick: () => surface('yellow_bricks', 2.2, { fallback: 0xb9a57e, tint: 0xe8dcc0, normalScale: 0.8 }),
  render: () => surface('white_plaster_02', 3, { fallback: 0xdcd8cf, tint: 0xf2eee6, normalScale: 0.5 }),
};

/** All buildings, merged into one mesh per material. */
export function buildingsGroup(buildings: Building[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'buildings';
  const walls: Record<Wall, THREE.BufferGeometry[]> = { redBrick: [], yellowBrick: [], render: [] };
  const slate: THREE.BufferGeometry[] = [];
  const tile: THREE.BufferGeometry[] = [];
  const flat: THREE.BufferGeometry[] = [];
  for (const b of buildings) {
    if (b.footprint.length < 3) continue;
    const box = boxOf(b.footprint);
    const s = styleOf(b, box);
    walls[s.wall].push(wallGeometry(b.footprint, s));
    if (s.roof === 'hip') (s.roofLook === 'slate' ? slate : tile).push(hipRoof(box, s.eaveM));
    else {
      const top = flatRoof(b.footprint, s.eaveM);
      if (top) flat.push(top);
    }
  }
  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (!parts.length) return;
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  for (const w of Object.keys(walls) as Wall[]) add(walls[w], withWindows(WALL_LOOK[w]()));
  add(slate, surface('roof_slates_02', 2.5, { fallback: 0x4a4e55, tint: 0xb8bcc4, params: { side: THREE.DoubleSide } }));
  add(tile, surface('clay_roof_tiles', 2.5, { fallback: 0x8a4a38, tint: 0xd8b8a8, params: { side: THREE.DoubleSide } }));
  add(flat, new THREE.MeshStandardMaterial({ color: 0x5b5d60, roughness: 0.95 }));
  return group;
}
