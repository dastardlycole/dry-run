import * as THREE from 'three';

// Light, sky and shadows: the cloudy sky photo is both the backdrop and the soft light on every surface,
// and one sun casts shadows in a box that follows the car (only near shadows are worth their cost).

/** Half the side of the box the sun casts shadows in, in metres. */
const SHADOW_HALF_M = 70;
/** The sun comes from here (south-west, fairly high), relative to what it lights. */
const SUN_DIR = new THREE.Vector3(-0.55, 0.75, 0.38).normalize();
/** The shadow map's own across and up directions (the light looks along -SUN_DIR). */
const LIGHT_RIGHT = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
const LIGHT_UP = new THREE.Vector3().crossVectors(SUN_DIR, LIGHT_RIGHT).normalize();
/** Haze colour, close to the sky near the horizon. */
const HAZE = 0xc4d0dc;

export class Look {
  readonly sun = new THREE.DirectionalLight(0xfff4e5, 2.4);
  private centre = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Updated once per frame by the render loop, not on every render (the mirror renders the scene too).
    renderer.shadowMap.autoUpdate = false;

    // Shown until the sky photo arrives (or for good, if it never does).
    scene.background = new THREE.Color(0x9fb8d0);
    scene.fog = new THREE.Fog(HAZE, 250, 1400);
    scene.add(new THREE.HemisphereLight(0xdde8f5, 0x5a5348, 0.6));

    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.camera.left = s.shadow.camera.bottom = -SHADOW_HALF_M;
    s.shadow.camera.right = s.shadow.camera.top = SHADOW_HALF_M;
    s.shadow.camera.near = 1;
    s.shadow.camera.far = 400;
    s.shadow.bias = -0.0005;
    s.shadow.normalBias = 0.05;
    scene.add(s, s.target);

    new THREE.TextureLoader().load(
      '/textures/sky.jpg',
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        scene.background = tex;
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        scene.environmentIntensity = 0.7;
        pmrem.dispose();
      },
      undefined,
      (err) => console.warn('[look] sky failed to load, keeping the plain sky', err),
    );
  }

  /**
   * Keep the shadow box centred on the car, moved only in whole shadow texels along the light's own
   * axes, so shadow edges stay put instead of crawling as the car drives.
   */
  follow(pos: THREE.Vector3) {
    const texel = (SHADOW_HALF_M * 2) / this.sun.shadow.mapSize.x;
    const snap = (v: number) => Math.round(v / texel) * texel;
    const c = this.centre.set(pos.x, 0, pos.z);
    const r = c.dot(LIGHT_RIGHT);
    const u = c.dot(LIGHT_UP);
    c.addScaledVector(LIGHT_RIGHT, snap(r) - r).addScaledVector(LIGHT_UP, snap(u) - u);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(SUN_DIR, 200);
  }
}
