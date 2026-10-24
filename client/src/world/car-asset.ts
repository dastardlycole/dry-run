import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// The learner's car from a downloaded model (assets/models/corolla.glb: "2014 Toyota Corolla E180 EU (with
// interior)" by Armored Wave, CC BY 4.0, compressed with gltf-transform). Models come in any size, axis and
// drive side, so this works it out from the parts: the long side is the length, the dashboard is at the
// front, the steering wheel goes on the right (UK) and the wheels are found by corner, so they can turn and
// spin. It's scaled so its wheelbase matches the physics car's. Result in the car frame: +X forward, +Y up,
// +Z right, ground at y = 0, x = 0 halfway between the axles.

export interface CarAsset {
  /** Everything but the wheels. */
  body: THREE.Group;
  /** Front-left, front-right, rear-left, rear-right; each centred on its axle. */
  wheels: THREE.Group[];
  /** Where the driver's eyes are, in the car frame. */
  eye: THREE.Vector3;
  /** The interior mirror, in the car frame, if the model has one. */
  mirror: THREE.Vector3 | null;
  /** Size of the whole car, metres. */
  size: THREE.Vector3;
}

type Part = { geom: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] };
const boxOf = (g: THREE.BufferGeometry) => new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);

/** `wheelbaseM`: the distance between the physics car's axles, which the model is scaled to. */
export async function loadCarAsset(url: string, wheelbaseM: number): Promise<CarAsset> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // Bake every mesh into one frame (the file's own nesting has rotations and scales from the export).
  const baked: (Part & { name: string; box: THREE.Box3 })[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geom = toFloat(m.geometry).applyMatrix4(m.matrixWorld);
    baked.push({ geom, mat: m.material, name: ancestry(m), box: boxOf(geom) });
  });
  const box = new THREE.Box3();
  for (const b of baked) box.union(b.box);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const centreOf = (pred: (name: string) => boolean) => {
    const bx = new THREE.Box3();
    for (const b of baked) if (pred(b.name)) bx.union(b.box);
    return bx.isEmpty() ? null : bx.getCenter(new THREE.Vector3());
  };

  // Length along the longer of x and z; up is y (glTF).
  const alongX = size.x >= size.z;
  const steering = centreOf((n) => n.includes('steering'));
  const dash = centreOf((n) => n.includes('dashboard')) ?? steering ?? centre;
  const mirrorAt = centreOf((n) => n.includes('interior') && n.includes('miror'));
  // Forward: towards the dashboard. Right: then the steering wheel must be on the right, or we mirror.
  const fwdSign = Math.sign((alongX ? dash.x - centre.x : dash.z - centre.z) || 1);
  const fwd = alongX ? new THREE.Vector3(fwdSign, 0, 0) : new THREE.Vector3(0, 0, fwdSign);
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)); // +Z when fwd is +X
  const flip = Math.sign(new THREE.Vector3().subVectors(steering ?? dash, centre).dot(right) || 1) < 0; // left-hand drive

  // Model → car axes, in the model's own units: centre, turn so fwd is +X, mirror across if needed, ground at 0.
  const turn = new THREE.Matrix4()
    .makeScale(1, 1, flip ? -1 : 1)
    .multiply(new THREE.Matrix4().makeBasis(fwd, new THREE.Vector3(0, 1, 0), right).transpose())
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z));
  const bodyParts: Part[] = [];
  const wheelParts: Part[] = [];
  for (const b of baked) {
    b.geom.applyMatrix4(turn);
    // Mirroring turns every triangle inside out; swap two corners of each to turn them back.
    if (flip) flipWinding(b.geom);
    if (b.name.includes('wheels')) wheelParts.push(b);
    else bodyParts.push({ geom: b.geom, mat: b.name.includes('windows') ? clearGlass(b.mat) : b.mat });
  }

  // Wheels: every triangle goes to the corner its centre is in (front-left, front-right, rear-left, rear-right).
  const pieces: Part[][] = [[], [], [], []];
  for (const { geom, mat } of wheelParts) splitByCorner(geom).forEach((g, i) => g && pieces[i].push({ geom: g, mat }));
  const centreOfParts = (parts: Part[]) => {
    const bx = new THREE.Box3();
    for (const p of parts) bx.union(boxOf(p.geom));
    return bx.isEmpty() ? new THREE.Vector3() : bx.getCenter(new THREE.Vector3());
  };
  // Scale so the wheelbase matches the physics car, and put x = 0 halfway between the axles.
  const c = pieces.map(centreOfParts);
  const frontX = (c[0].x + c[1].x) / 2;
  const rearX = (c[2].x + c[3].x) / 2;
  const scale = frontX > rearX ? wheelbaseM / (frontX - rearX) : 1;
  const fit = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-(frontX + rearX) / 2, 0, 0));
  const toCar = (v: THREE.Vector3) => v.clone().applyMatrix4(turn).applyMatrix4(fit);

  const body = new THREE.Group();
  body.name = 'car-model';
  for (const p of bodyParts) {
    const mesh = new THREE.Mesh(p.geom.applyMatrix4(fit), p.mat);
    mesh.castShadow = true;
    body.add(mesh);
  }
  const wheels = pieces.map((parts) => {
    for (const p of parts) p.geom.applyMatrix4(fit);
    const at = centreOfParts(parts);
    const g = new THREE.Group();
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geom.translate(-at.x, -at.y, -at.z), p.mat);
      mesh.castShadow = true;
      g.add(mesh);
    }
    return g;
  });

  const carSize = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3());
  // The driver sits behind the steering wheel: eyes about 0.6 m back from it and 0.3 m above.
  const wheelInCar = toCar(steering ?? dash);
  const eye = new THREE.Vector3(wheelInCar.x - 0.6, wheelInCar.y + 0.3, wheelInCar.z);
  return { body, wheels, eye, mirror: mirrorAt && toCar(mirrorAt), size: carSize };
}

/** The model's windows are dark and half opaque, which dims the whole street from the driver's seat. */
function clearGlass(m: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  // Only the see-through materials are glass; anything else on the windows (frames, seals) stays as it is.
  if (Array.isArray(m)) return m.map((x) => clearGlass(x) as THREE.Material);
  if (!m.transparent) return m;
  const glass = m.clone() as THREE.MeshStandardMaterial;
  glass.color.set(0xa8b8c0);
  glass.opacity = 0.15;
  glass.transparent = true;
  glass.depthWrite = false;
  return glass;
}

/**
 * A copy with every attribute as plain floats. Compressed models store positions and normals as small
 * integers (KHR_mesh_quantization); moving and scaling those in place would wrap and garble them.
 */
function toFloat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
    const arr = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) arr[i * attr.itemSize + c] = attr.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
  }
  if (g.index) out.setIndex(g.index.clone());
  for (const grp of g.groups) out.addGroup(grp.start, grp.count, grp.materialIndex);
  return out;
}

/** The node path of a mesh, lower case, so "corolla_e180_wheels/…" can be matched by part name. */
function ancestry(o: THREE.Object3D): string {
  const names: string[] = [];
  for (let p: THREE.Object3D | null = o; p; p = p.parent) names.push(p.name.toLowerCase());
  return names.join('/');
}

function flipWinding(g: THREE.BufferGeometry) {
  const index = g.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes) as THREE.BufferAttribute[]) {
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < attr.itemSize; k++) {
          const b = attr.getComponent(i + 1, k);
          attr.setComponent(i + 1, k, attr.getComponent(i + 2, k));
          attr.setComponent(i + 2, k, b);
        }
      }
      attr.needsUpdate = true;
    }
  }
  // Normals were mirrored along with the positions; the flip above only fixes which side is the front.
  g.computeBoundingBox();
}

/** One geometry per corner (front-left, front-right, rear-left, rear-right), or null if a corner has none. */
function splitByCorner(g: THREE.BufferGeometry): (THREE.BufferGeometry | null)[] {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const buckets: number[][] = [[], [], [], []];
  for (let t = 0; t < pos.count; t += 3) {
    const x = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    buckets[(x >= 0 ? 0 : 2) + (z >= 0 ? 1 : 0)].push(t);
  }
  return buckets.map((tris) => {
    if (!tris.length) return null;
    const out = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes) as [string, THREE.BufferAttribute][]) {
      const arr = new Float32Array(tris.length * 3 * attr.itemSize);
      tris.forEach((t, k) => {
        for (let v = 0; v < 3; v++) for (let c = 0; c < attr.itemSize; c++) arr[(k * 3 + v) * attr.itemSize + c] = attr.getComponent(t + v, c);
      });
      out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
    }
    return out;
  });
}

