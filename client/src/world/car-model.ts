import * as THREE from 'three';

// A small hatchback (Fiesta-sized, 4 m × 1.75 m), used for the learner's car and the parked cars.
// Model frame: +X forward, +Y up, +Z right, y = 0 on the ground. Built from side profiles, so it's light.

type Pt = [x: number, y: number];

/** Painted lower body up to the window line, side profile. */
const BODY: Pt[] = [
  [-2.0, 0.25], [-2.04, 0.55], [-1.97, 0.95], [0.95, 0.95], [1.85, 0.8], [2.02, 0.6], [2.0, 0.42], [1.95, 0.25],
];
/** Glass cabin above the window line. */
const CABIN: Pt[] = [[-1.94, 0.95], [-1.72, 1.36], [0.16, 1.39], [0.95, 0.95]];
const BODY_W = 1.62;
const CABIN_W = 1.42;
/** Rounds the edges; it also pushes every face out by this much, so lamps and plates sit beyond it. */
const BEVEL = 0.07;

function sideExtrude(profile: Pt[], width: number, bevel: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -width / 2);
  return g;
}

// Shared by every car; only the paint differs.
const shared = (() => {
  const body = sideExtrude(BODY, BODY_W, BEVEL);
  const cabin = sideExtrude(CABIN, CABIN_W, 0.06);
  const roof = new THREE.BoxGeometry(1.8, 0.06, CABIN_W + 0.1).translate(-0.78, 1.4, 0);
  const lamp = new THREE.BoxGeometry(0.06, 0.12, 0.32);
  const plate = new THREE.BoxGeometry(0.02, 0.11, 0.52);
  return {
    body,
    cabin,
    roof,
    headLamps: [lamp.clone().translate(2.07, 0.7, -0.58), lamp.clone().translate(2.07, 0.7, 0.58)],
    tailLamps: [lamp.clone().translate(-2.09, 0.78, -0.62), lamp.clone().translate(-2.09, 0.78, 0.62)],
    frontPlate: plate.clone().translate(2.12, 0.47, 0),
    rearPlate: plate.clone().translate(-2.16, 0.5, 0),
    tyre: new THREE.CylinderGeometry(0.31, 0.31, 0.22, 20).rotateX(Math.PI / 2),
    hub: new THREE.CylinderGeometry(0.19, 0.19, 0.235, 16).rotateX(Math.PI / 2),
    mats: {
      glass: new THREE.MeshStandardMaterial({ color: 0x1a2128, roughness: 0.08, metalness: 0.7 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 }),
      hub: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.9 }),
      head: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, emissive: 0xfff6e0, emissiveIntensity: 0.4 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x9a1010, emissive: 0x600000, emissiveIntensity: 0.5 }),
      whitePlate: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
      yellowPlate: new THREE.MeshStandardMaterial({ color: 0xf2c418, roughness: 0.4 }),
    },
  };
})();

/** Where the wheels sit (centres, on the ground), matching the physics car's axles. */
export const WHEEL_POS: Pt[] = [[1.3, 0.31], [-1.3, 0.31]];

/**
 * The car body in `paint`. With `wheels`, adds four static wheels (parked cars); the driven car makes its own
 * so they can turn and spin. `lift` moves it up or down, e.g. to sit on a physics body's centre.
 */
export function carModel(paint: number, { wheels = false, lift = 0 } = {}): THREE.Group {
  const g = new THREE.Group();
  const m = shared.mats;
  const paintMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.35, metalness: 0.5 });
  const add = (geom: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.position.y = lift;
    g.add(mesh);
    return mesh;
  };
  add(shared.body, paintMat);
  add(shared.cabin, m.glass);
  add(shared.roof, paintMat);
  for (const l of shared.headLamps) add(l, m.head);
  for (const l of shared.tailLamps) add(l, m.tail);
  add(shared.frontPlate, m.whitePlate);
  add(shared.rearPlate, m.yellowPlate);
  if (wheels)
    for (const [x, y] of WHEEL_POS)
      for (const z of [-0.78, 0.78]) {
        add(shared.tyre, m.tyre).position.set(x, y + lift, z);
        add(shared.hub, m.hub).position.set(x, y + lift, z);
      }
  return g;
}

/** The tyre and hub for a driven car's wheel, centred on the axle. */
export function wheelModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(shared.tyre, shared.mats.tyre), new THREE.Mesh(shared.hub, shared.mats.hub));
  g.children.forEach((c) => (c.castShadow = true));
  return g;
}
