import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Pose, WorldData } from './types';

// Things the car can crash into (SPEC §4.2 FR-V5): buildings and parked cars. The roads are flat at
// ground level, so the car drives on the single ground collider set up in main.ts.

/** One fixed collider made of every building's walls. Roofs aren't needed: the car can't get up there. */
export function addBuildingColliders(world: RAPIER.World, data: WorldData): RAPIER.Collider | null {
  const verts: number[] = [];
  const index: number[] = [];
  for (const b of data.buildings) {
    const ring = b.footprint;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const v = verts.length / 3;
      verts.push(ax, 0, az, bx, 0, bz, bx, b.heightM, bz, ax, b.heightM, az);
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }
  if (index.length === 0) return null;
  return world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(index)));
}

const PARKED = { length: 4.2, width: 1.8, height: 1.45 };
const PAINT = [0x2b4c7e, 0xd9d9d9, 0x1d1d1d, 0x8a8f94, 0x6b1f1f, 0x2f5d3a];

/** Parked cars: a simple body and cabin each, with a fixed box collider. */
export function addParkedCars(world: RAPIER.World, scene: THREE.Scene, cars: Pose[]): RAPIER.Collider[] {
  const glass = new THREE.MeshLambertMaterial({ color: 0x2a3440 });
  const bodyGeom = new THREE.BoxGeometry(PARKED.length, 0.8, PARKED.width);
  const cabinGeom = new THREE.BoxGeometry(2.2, 0.6, PARKED.width - 0.15);
  return cars.map(({ pos: [x, z], heading }, i) => {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(bodyGeom, new THREE.MeshLambertMaterial({ color: PAINT[i % PAINT.length] }));
    body.position.y = 0.65;
    const cabin = new THREE.Mesh(cabinGeom, glass);
    cabin.position.set(-0.3, 1.35, 0);
    mesh.add(body, cabin);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);

    const rot = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    return world.createCollider(
      RAPIER.ColliderDesc.cuboid(PARKED.length / 2, PARKED.height / 2, PARKED.width / 2)
        .setTranslation(x, PARKED.height / 2, z)
        .setRotation(rot),
    );
  });
}
