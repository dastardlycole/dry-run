import * as THREE from 'three';

// Surface textures (Poly Haven, CC0) from /assets/textures. Geometry UVs are in metres, so each texture
// is scaled by how many metres one copy of it covers. Materials start as a plain colour and pick up
// their texture when it arrives, so the world never waits for a download.

const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();
let maxAnisotropy = 8;

/** Call once with the renderer, so textures stay sharp at low angles (roads seen from the driver's seat). */
export function setAnisotropy(renderer: THREE.WebGLRenderer) {
  maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

function load(file: string, sizeM: number, srgb: boolean, onLoad: (t: THREE.Texture) => void) {
  const key = `${file}@${sizeM}`;
  let p = cache.get(key);
  if (!p) {
    p = loader.loadAsync(`/textures/${file}`).then((tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(1 / sizeM, 1 / sizeM);
      tex.anisotropy = maxAnisotropy;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return tex;
    });
    cache.set(key, p);
  }
  p.then(onLoad, (err) => console.warn(`[textures] ${file} failed to load`, err));
}

export interface SurfaceOptions {
  /** Colour shown until the texture arrives, and if it never does. */
  fallback: number;
  /** Multiplies the texture once loaded (white leaves it as it is). */
  tint?: number;
  roughness?: number;
  normalScale?: number;
  /** Extra material settings, e.g. depthWrite for the flat layers. */
  params?: THREE.MeshStandardMaterialParameters;
}

/** A material with `<name>_diff.jpg` and `<name>_nor.jpg`, one copy every `sizeM` metres. */
export function surface(name: string, sizeM: number, o: SurfaceOptions): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: o.fallback, roughness: o.roughness ?? 0.9, metalness: 0, ...o.params });
  load(`${name}_diff.jpg`, sizeM, true, (t) => {
    mat.map = t;
    mat.color.setHex(o.tint ?? 0xffffff);
    mat.needsUpdate = true;
  });
  load(`${name}_nor.jpg`, sizeM, false, (t) => {
    mat.normalMap = t;
    mat.normalScale.setScalar(o.normalScale ?? 1);
    mat.needsUpdate = true;
  });
  return mat;
}
