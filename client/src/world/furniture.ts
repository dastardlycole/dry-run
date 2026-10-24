import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dashPieces, halfWidthsAt, headingOf, pointAlong, posKey, rightOf, stripTriangles } from './geometry';
import { siteLight, stopLineBackM, type Light, type SiteLights } from './lights';
import { COLOURS, flatMesh, LAYER } from './world';
import type { Road, Route, StopLine, Vec2, WorldData } from './types';

// Route and junction furniture (SPEC §4.1 FR-W2, FR-W3, §4.3 FR-T1): traffic light heads, stop and
// give-way lines on the route, and the route guide line.

export async function loadRoute(base: string, routeId: string): Promise<Route> {
  const res = await fetch(`${base}/route-${routeId}.json`);
  if (!res.ok) throw new Error(`route-${routeId}.json: HTTP ${res.status} (run npm run route-build -w tools)`);
  return res.json();
}

const STOP_LINE_W = 0.3;
const GIVE_WAY_W = 0.2;

/** Solid white stop lines and double dashed give-way lines across the route's approaches. */
export function routeLinesMesh(route: Route): THREE.Mesh {
  const tris: Vec2[] = [];
  const lines = route.steps.map((s) => s.line).filter((l): l is StopLine => !!l);
  for (const { kind, a, b } of lines) {
    if (kind === 'stop') tris.push(...stripTriangles([a, b], -STOP_LINE_W / 2, STOP_LINE_W / 2));
    else
      for (const offset of [-0.15, 0.35])
        for (const piece of dashPieces([a, b], 0.6, 0.3)) tris.push(...stripTriangles(piece, offset - GIVE_WAY_W / 2, offset + GIVE_WAY_W / 2));
  }
  return flatMesh(tris, COLOURS.marking, LAYER.marking);
}

const ARROW_EVERY_M = 6;
/** Arrows show from just ahead of the car to this far along the route. */
const ARROW_AHEAD_M = 120;
const ARROW_FROM_M = 4;
const ARROW_LINE_W = 0.26;
/** Vertices per arrow: two arms, each a strip of 2 triangles. */
const ARROW_VERTS = 12;

/**
 * Blue chevrons on the road for the next stretch of the route only, pointing the way to go, so the
 * route can be driven before spoken directions exist. Only one leg of the loop shows at a time.
 */
export class GuideArrows {
  readonly mesh: THREE.Mesh;
  private arrowM: number[] = [];

  constructor(route: Route) {
    const tris: Vec2[] = [];
    for (let m = ARROW_EVERY_M; m < route.lengthM; m += ARROW_EVERY_M) {
      const { p, dir } = pointAlong(route.line, m);
      const r = rightOf(dir);
      const at = (ahead: number, side: number): Vec2 => [p[0] + dir[0] * ahead + r[0] * side, p[1] + dir[1] * ahead + r[1] * side];
      const tip = at(0.6, 0);
      const w = ARROW_LINE_W / 2;
      tris.push(...stripTriangles([at(-0.5, -0.9), tip], -w, w), ...stripTriangles([tip, at(-0.5, 0.9)], -w, w));
      this.arrowM.push(m);
    }
    this.mesh = flatMesh(tris, 0x2f7df6, LAYER.marking + 0.5);
    const mat = this.mesh.material as THREE.Material;
    mat.transparent = true;
    mat.opacity = 0.8;
    this.show(0);
  }

  /** Show the arrows ahead of a car `m` metres along the route. */
  show(m: number) {
    const first = this.arrowM.findIndex((a) => a >= m + ARROW_FROM_M);
    if (first < 0) {
      this.mesh.geometry.setDrawRange(0, 0);
      return;
    }
    let last = first;
    while (last < this.arrowM.length && this.arrowM[last] <= m + ARROW_AHEAD_M) last++;
    this.mesh.geometry.setDrawRange(first * ARROW_VERTS, (last - first) * ARROW_VERTS);
  }
}

const POLE_H = 3.2;
const HEAD = { w: 0.32, h: 0.95, d: 0.25 };
const LAMP_R = 0.11;
const LAMPS = [
  { y: 0.3, on: 0xff2a1a, off: 0x3a1210 }, // red
  { y: 0, on: 0xffa500, off: 0x3a2a0c }, // amber
  { y: -0.3, on: 0x2bff6a, off: 0x0e3018 }, // green
];
const LIT: Record<Light, [boolean, boolean, boolean]> = {
  red: [true, false, false],
  redAmber: [true, true, false],
  green: [false, false, true],
  amber: [false, true, false],
};

/**
 * One light head on a pole at the left kerb of every road entering a signal junction, at the stop line.
 * Poles and heads are one merged mesh; each lamp colour is one instanced mesh, so it's 4 draw calls in all.
 */
export class LightHeads {
  private lamps: THREE.InstancedMesh[];
  private heads: { s: SiteLights; group: 0 | 1 }[] = [];
  private colour = new THREE.Color();
  /** Light last shown on each head, so lamps are only rewritten when it changes. */
  private shown: (Light | undefined)[] = [];

  constructor(scene: THREE.Scene, sites: SiteLights[], data: WorldData) {
    const roads = new Map<number, Road>(data.roads.map((r) => [r.wayId, r]));
    const half = halfWidthsAt(data.roads);
    const frames: THREE.Matrix4[] = [];
    for (const s of sites) {
      for (const a of s.approaches) {
        const road = roads.get(a.edge.wayId);
        if (!road) continue;
        const end = a.edge.points[a.edge.points.length - 1];
        const back = stopLineBackM(half.get(posKey(end)) ?? road.widthM / 2);
        const { p, dir } = pointAlong([...a.edge.points].reverse(), back);
        const travel: Vec2 = [-dir[0], -dir[1]];
        const r = rightOf(travel);
        const out = -(road.widthM / 2 + 0.6);
        const m = new THREE.Matrix4()
          .makeRotationY(headingOf(-travel[0], -travel[1])) // face the oncoming driver
          .setPosition(p[0] + r[0] * out, 0, p[1] + r[1] * out);
        frames.push(m);
        this.heads.push({ s, group: a.group });
      }
    }

    const parts: THREE.BufferGeometry[] = [];
    for (const m of frames) {
      const pole = new THREE.CylinderGeometry(0.06, 0.06, POLE_H, 6).translate(0, POLE_H / 2, 0);
      const head = new THREE.BoxGeometry(HEAD.d, HEAD.h, HEAD.w).translate(0, POLE_H - HEAD.h / 2 + 0.2, 0);
      parts.push(pole.applyMatrix4(m), head.applyMatrix4(m));
    }
    if (parts.length) {
      const merged = mergeGeometries(parts);
      parts.forEach((g) => g.dispose());
      scene.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: 0x23262a })));
    }

    // Lamps: discs on the front face of each head (local +X faces the driver).
    const disc = new THREE.CircleGeometry(LAMP_R, 12).rotateY(Math.PI / 2);
    this.lamps = LAMPS.map((lamp) => {
      const mesh = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial(), frames.length);
      const local = new THREE.Matrix4().makeTranslation(HEAD.d / 2 + 0.01, POLE_H - HEAD.h / 2 + 0.2 + lamp.y, 0);
      frames.forEach((m, i) => {
        mesh.setMatrixAt(i, m.clone().multiply(local));
        mesh.setColorAt(i, this.colour.setHex(lamp.off));
      });
      scene.add(mesh);
      return mesh;
    });
  }

  /** Show the lights at sim time `t` seconds. */
  update(t: number) {
    let changed = false;
    this.heads.forEach(({ s, group }, i) => {
      const light = siteLight(s, group, t);
      if (this.shown[i] === light) return;
      this.shown[i] = light;
      changed = true;
      const lit = LIT[light];
      this.lamps.forEach((mesh, k) => mesh.setColorAt(i, this.colour.setHex(lit[k] ? LAMPS[k].on : LAMPS[k].off)));
    });
    if (changed) for (const mesh of this.lamps) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
