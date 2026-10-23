import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CENTRE } from '../config';
import { buildWorld, emptyWorld, groundHalfM, loadWorld } from '../world/world';
import { Cameras } from './camera';
import { Car } from './car';
import { toggleIndicator, type Indicator } from './controls';
import { Hud } from './hud';
import { Input } from './input';

// The drivable car in the OSM world around the test centre (SPEC §4.1, §4.2).
const PHYSICS_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

await RAPIER.init();

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc7e8);
scene.fog = new THREE.Fog(0x9cc7e8, 400, 1500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 100, 30);
scene.add(sun);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = PHYSICS_DT;
const events = new RAPIER.EventQueue(true);

// The road and building meshes are visual only for now; the car drives on a flat ground collider.
// Road and building colliders come with the world-route feature (SPEC §4.1, §4.2).
const groundHalf = groundHalfM(CENTRE.radiusM);
const groundCollider = world.createCollider(
  RAPIER.ColliderDesc.cuboid(groundHalf, 0.1, groundHalf).setTranslation(0, -0.1, 0),
);
// If the map can't load, keep going on plain grass so the car still drives.
let mapNote = '';
const worldData = await loadWorld(CENTRE.id).catch((err) => {
  console.error('[world] failed to load, using empty world', err);
  mapNote = 'map failed to load · ';
  return emptyWorld(CENTRE);
});
const startPose = buildWorld(worldData, scene);

const car = new Car(world, scene);
car.setStart(startPose.x, startPose.z, startPose.heading);
car.reset();
const cameras = new Cameras(car);
const input = new Input();
const hud = new Hud();
let indicator: Indicator = 'off';
let paused = false;

/** Collisions involving the car. Logged for now; the R11 fault rule hooks in here later. */
function onCollision(other: RAPIER.Collider) {
  const p = other.translation();
  console.log(`[car] collision with object at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  hud.flashCollision();
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  cameras.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let acc = 0;
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  for (const action of input.takeActions()) {
    if (action === 'pause') paused = !paused;
    else if (action === 'camera') cameras.toggle();
    else if (action === 'reset') {
      car.reset();
      indicator = 'off';
    } else if (!paused) indicator = toggleIndicator(indicator, action === 'indicateLeft' ? 'left' : 'right');
  }

  if (!paused) {
    acc += dt;
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
      car.update(input.drive(), PHYSICS_DT);
      world.step(events);
      events.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const carHandle = car.collider.handle;
        if (h1 !== carHandle && h2 !== carHandle) return;
        const other = h1 === carHandle ? h2 : h1;
        // The body scraping the ground (hard braking, bumps) isn't a crash.
        if (other === groundCollider.handle) return;
        onCollision(world.getCollider(other));
      });
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0; // fell behind; don't spiral
  }

  car.sync();
  car.mesh.updateMatrixWorld();
  cameras.update({ lookLeft: input.lookLeft, lookRight: input.lookRight, mirror: input.mirror }, dt);
  hud.update({ speedMph: car.speedMph, gear: car.gear, indicator, camera: cameras.mode, paused }, now);
  cameras.render(renderer, scene);
});

// Handy for poking at the sim from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { sim: { car, input, world, cameras } });

const status = document.querySelector('#status')!;
fetch('/api/health')
  .then((r) => r.json())
  .then((h) => (status.textContent = `${mapNote}server ok · mongo ${h.mongo}`))
  .catch(() => (status.textContent = `${mapNote}server offline`));
