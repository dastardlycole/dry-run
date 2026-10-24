import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dashPieces, offsetPolyline, stripTriangles } from './geometry';
import { along, BoxGrid, distToSegment, insideRing, nearRing, rng } from './scenery';
import { surface } from './textures';
import { COLOURS, flatMesh, hasPavement, LAYER, PAVEMENT_M } from './world';
import type { Road, SceneryData, Vec2, WorldData } from './types';

// Street details that make it read as a London suburb (looks only, nothing collides): lamp columns,
// low brick walls and hedges in front of houses, zebra crossings with Belisha beacons, and studs across
// the road at signal crossings.

const LAMP_GAP_M = 32;
/** A mapped lamp this close means the stretch already has one. */
const LAMP_NEAR_M = 15;
const LAMP_H = 6;
const GARDEN_ROADS = new Set(['residential', 'living_street', 'unclassified']);
const NO_LAMPS = new Set(['service', 'motorway', 'motorway_link']);

interface NearRoad {
  road: Road;
  /** Unit direction of the road there, and the nearest point on it. */
  dir: Vec2;
  at: Vec2;
  d: number;
}

export function streetDetails(world: WorldData, scenery: SceneryData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'street';
  const rand = rng(99);

  const roadGrid = new BoxGrid<{ road: Road; a: Vec2; b: Vec2 }>(25);
  for (const road of world.roads)
    for (let i = 0; i < road.points.length - 1; i++) {
      const [a, b] = [road.points[i], road.points[i + 1]];
      const r = road.widthM / 2 + PAVEMENT_M + 3;
      roadGrid.add({ road, a, b }, Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r);
    }
  const nearestRoad = (p: Vec2): NearRoad | null => {
    let best: NearRoad | null = null;
    for (const { road, a, b } of roadGrid.at(p)) {
      const d = distToSegment(p, a, b);
      if (best && d >= best.d) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const t = Math.max(0, Math.min(len, (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1]));
      best = { road, dir, at: [a[0] + dir[0] * t, a[1] + dir[1] * t], d };
    }
    return best;
  };
  const buildingGrid = new BoxGrid<Vec2[]>(25);
  for (const b of world.buildings) {
    const xs = b.footprint.map((p) => p[0]);
    const zs = b.footprint.map((p) => p[1]);
    buildingGrid.add(b.footprint, Math.min(...xs) - 3, Math.min(...zs) - 3, Math.max(...xs) + 3, Math.max(...zs) + 3);
  }
  const nearBuilding = (p: Vec2, d: number) => buildingGrid.at(p).some((ring) => insideRing(p, ring) || nearRing(p, ring, d));
  const junctions = world.junctions.filter((j) => j.degree >= 3);
  const junctionGrid = new BoxGrid<{ p: Vec2; r: number }>(25);
  for (const j of junctions) junctionGrid.add({ p: j.pos, r: 12 }, j.pos[0] - 12, j.pos[1] - 12, j.pos[0] + 12, j.pos[1] + 12);
  const atJunction = (p: Vec2, r = 12) => junctionGrid.at(p).some((j) => Math.hypot(p[0] - j.p[0], p[1] - j.p[1]) < r);
  const greens = scenery.areas.filter((a) => a.kind !== 'water');
  const inGreen = (p: Vec2) => greens.some((a) => insideRing(p, a.ring));

  // Lamp columns: every mapped one, plus one every LAMP_GAP_M along roads that have none mapped nearby.
  const lampGrid = new BoxGrid<Vec2>(LAMP_NEAR_M);
  for (const l of scenery.lamps) lampGrid.add(l, l[0], l[1], l[0], l[1]);
  const lamps: { p: Vec2; facing: Vec2 }[] = [];
  for (const l of scenery.lamps) {
    const n = nearestRoad(l);
    if (n && n.d > 0.5) lamps.push({ p: l, facing: [(n.at[0] - l[0]) / n.d, (n.at[1] - l[1]) / n.d] });
  }
  const hasLampNear = (p: Vec2) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        if (lampGrid.at([p[0] + dx * LAMP_NEAR_M, p[1] + dz * LAMP_NEAR_M]).some((l) => Math.hypot(l[0] - p[0], l[1] - p[1]) < LAMP_NEAR_M)) return true;
    return false;
  };
  for (const road of world.roads) {
    if (NO_LAMPS.has(road.highway)) continue;
    const half = road.widthM / 2;
    along(road.points, LAMP_GAP_M).forEach((p, i) => {
      const n = nearestRoad(p);
      if (!n || atJunction(p, 10)) return;
      // Alternate sides, at the back of the kerb, facing the road.
      const side = i % 2 ? 1 : -1;
      const right: Vec2 = [-n.dir[1], n.dir[0]];
      const at: Vec2 = [p[0] + right[0] * side * (half + 0.45), p[1] + right[1] * side * (half + 0.45)];
      if (hasLampNear(at) || nearBuilding(at, 0.5)) return;
      lamps.push({ p: at, facing: [-right[0] * side, -right[1] * side] });
    });
  }
  group.add(lampMesh(lamps));

  // Front garden walls and hedges along residential pavements, with gaps for drives and side roads.
  const mouthGrid = new BoxGrid<{ c: Vec2; r: number }>(25);
  for (const j of junctions) {
    const r = 9;
    mouthGrid.add({ c: j.pos, r }, j.pos[0] - r, j.pos[1] - r, j.pos[0] + r, j.pos[1] + r);
  }
  // Every mouth in the grid cells the segment a–b passes through (sampled at less than a cell apart).
  const mouthsNear = (a: Vec2, b: Vec2) => {
    const found = new Set<{ c: Vec2; r: number }>();
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 20) + 1;
    for (let k = 0; k <= steps; k++) for (const m of mouthGrid.at([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps])) found.add(m);
    return [...found];
  };
  // A wall runs just behind its own road's pavement; one reaching another road or its pavement (a corner
  // where two roads meet, or a side road off a bend) would stand across that road. Checked every metre.
  const onOtherRoad = (p: Vec2, own: Road) =>
    roadGrid.at(p).some(({ road, a, b }) => road !== own && distToSegment(p, a, b) < road.widthM / 2 + (hasPavement(road) ? PAVEMENT_M : 0));
  const crossesRoad = (line: Vec2[], own: Road) => [...line, ...along(line, 1)].some((p) => onOtherRoad(p, own));
  const walls: Vec2[][] = [];
  const hedges: Vec2[][] = [];
  for (const road of world.roads) {
    if (!GARDEN_ROADS.has(road.highway)) continue;
    const half = road.widthM / 2;
    for (const piece of dashPieces(road.points, 7 + rand() * 6, 3, (a, b) => mouthsNear(a, b))) {
      for (const side of [-1, 1]) {
        const line = offsetPolyline(piece, side * (half + PAVEMENT_M + 0.25));
        const mid = line[Math.floor(line.length / 2)];
        if (line.some((p) => nearBuilding(p, 1.2)) || inGreen(mid) || crossesRoad(line, road)) continue;
        (rand() < 0.55 ? walls : hedges).push(line);
      }
    }
  }
  group.add(
    strips(walls, 0.25, 0.75, surface('red_brick', 2.2, { fallback: 0x8a4a3a, normalScale: 0.8 })),
    strips(hedges, 0.7, 1.15, surface('leafy_grass', 1.5, { fallback: 0x2f4a24, tint: 0x4a6a34, normalScale: 2 })),
  );

  // Crossings: across the road at the crossing point.
  const zebra: Vec2[] = [];
  const studs: Vec2[] = [];
  const beacons: { p: Vec2 }[] = [];
  for (const c of scenery.crossings) {
    const n = nearestRoad(c.pos);
    if (!n || n.d > 2) continue;
    const half = n.road.widthM / 2;
    const right: Vec2 = [-n.dir[1], n.dir[0]];
    const across = (o: number, s: number): Vec2 => [n.at[0] + right[0] * s + n.dir[0] * o, n.at[1] + right[1] * s + n.dir[1] * o];
    if (c.kind === 'zebra') {
      // Stripes 0.5 m wide and 2.5 m long (along the road), 0.5 m apart, kerb to kerb.
      for (let s = -half + 0.25; s + 0.5 <= half; s += 1) zebra.push(...stripTriangles([across(-1.25, s + 0.25), across(1.25, s + 0.25)], -0.25, 0.25));
      beacons.push({ p: across(0, -half - 0.6) }, { p: across(0, half + 0.6) });
    } else {
      // Two lines of studs across the road, 2.4 m apart.
      for (const o of [-1.2, 1.2])
        for (const piece of dashPieces([across(o, -half), across(o, half)], 0.12, 0.5)) studs.push(...stripTriangles(piece, -0.06, 0.06));
    }
  }
  group.add(flatMesh(zebra, COLOURS.marking, LAYER.marking), flatMesh(studs, 0xcfcfc8, LAYER.marking));
  group.add(beaconMesh(beacons.map((b) => b.p)));
  return group;
}

/** UK lamp column: a tall grey pole, a short arm reaching over the road and a flat lantern. */
function lampMesh(lamps: { p: Vec2; facing: Vec2 }[]): THREE.InstancedMesh {
  const pole = new THREE.CylinderGeometry(0.06, 0.09, LAMP_H, 8).translate(0, LAMP_H / 2, 0);
  const arm = new THREE.BoxGeometry(1.0, 0.07, 0.07).translate(0.45, LAMP_H - 0.05, 0);
  const lantern = new THREE.BoxGeometry(0.7, 0.12, 0.28).translate(1.05, LAMP_H - 0.1, 0);
  const geom = mergeGeometries([pole, arm, lantern])!;
  const mat = new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.6 });
  const mesh = new THREE.InstancedMesh(geom, mat, lamps.length);
  const m = new THREE.Matrix4();
  lamps.forEach(({ p, facing }, i) => {
    // Local +X (the arm) turned to point at the road.
    m.makeRotationY(Math.atan2(-facing[1], facing[0])).setPosition(p[0], 0, p[1]);
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  return mesh;
}

/** Belisha beacons: black and white striped poles with an amber globe. */
function beaconMesh(points: Vec2[]): THREE.Group {
  const group = new THREE.Group();
  const bands: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) bands.push(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8).translate(0, 0.15 + k * 0.3, 0));
  const place = (geoms: THREE.BufferGeometry[], mat: THREE.Material) => {
    const geom = mergeGeometries(geoms)!;
    const mesh = new THREE.InstancedMesh(geom, mat, points.length);
    points.forEach(([x, z], i) => mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, z)));
    group.add(mesh);
  };
  place(bands.filter((_, k) => k % 2 === 0), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }));
  place(bands.filter((_, k) => k % 2 === 1), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 }));
  place([new THREE.SphereGeometry(0.17, 16, 12).translate(0, 2.6, 0)], new THREE.MeshStandardMaterial({ color: 0xff9a1a, emissive: 0xff7a00, emissiveIntensity: 0.8 }));
  return group;
}

/** Low solid strips along lines (walls, hedges): `width` thick, `height` tall, UVs in metres. */
function strips(lines: Vec2[][], width: number, height: number, mat: THREE.Material): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    const sides = [offsetPolyline(line, -width / 2), offsetPolyline(line, width / 2)];
    let s = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const len = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
      for (const side of sides) {
        const [a, b] = [side[i], side[i + 1]];
        pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], height, b[1], a[0], 0, a[1], b[0], height, b[1], a[0], height, a[1]);
        uv.push(s, 0, s + len, 0, s + len, height, s, 0, s + len, height, s, height);
      }
      const [l0, l1, r0, r1] = [sides[0][i], sides[0][i + 1], sides[1][i], sides[1][i + 1]];
      pos.push(l0[0], height, l0[1], l1[0], height, l1[1], r0[0], height, r0[1], r0[0], height, r0[1], l1[0], height, l1[1], r1[0], height, r1[1]);
      uv.push(s, 0, s + len, 0, s, width, s, width, s + len, 0, s + len, width);
      s += len;
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.computeVertexNormals();
  (mat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
