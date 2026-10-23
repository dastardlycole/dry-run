import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Cameras } from './camera';
import { Car } from './car';
import { toggleIndicator, type Indicator } from './controls';
import { Hud } from './hud';
import { Input } from './input';

// Flat test plane with a drivable car. The OSM world replaces the plane in later features (SPEC §4.1).
const PHYSICS_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

await RAPIER.init();

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc7e8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 100, 30);
scene.add(sun);

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = PHYSICS_DT;
const events = new RAPIER.EventQueue(true);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshLambertMaterial({ color: 0x4a7a3a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
// Grid lines so you can see the car moving.
const grid = new THREE.GridHelper(2000, 400, 0x3d6630, 0x3d6630);
grid.position.y = 0.01;
scene.add(grid);
const groundCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.1, 1000).setTranslation(0, -0.1, 0));

// Test obstacles: fixed blocks (like walls) and light cones that get knocked over.
const blockMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
const blocks: [number, number, number, number][] = [
  [40, 10, 4, 4],
  [60, -15, 2, 10],
  [-30, 25, 8, 2],
  [0, -40, 6, 6],
];
for (const [x, z, w, d] of blocks) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), blockMat);
  mesh.position.set(x, 1, z);
  scene.add(mesh);
  world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, 1, d / 2).setTranslation(x, 1, z));
}

const coneMat = new THREE.MeshLambertMaterial({ color: 0xff7a00 });
const coneGeom = new THREE.ConeGeometry(0.25, 0.7, 12);
const cones: { mesh: THREE.Mesh; body: RAPIER.RigidBody }[] = [];
for (let i = 0; i < 8; i++) {
  const x = 20 + i * 6;
  const z = i % 2 === 0 ? -3 : 3;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.35, z));
  world.createCollider(RAPIER.ColliderDesc.cone(0.35, 0.25).setMass(3), body);
  const mesh = new THREE.Mesh(coneGeom, coneMat);
  scene.add(mesh);
  cones.push({ mesh, body });
}

const car = new Car(world, scene);
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
  for (const c of cones) {
    const t = c.body.translation();
    const r = c.body.rotation();
    c.mesh.position.set(t.x, t.y, t.z);
    c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
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
  .then((h) => (status.textContent = `server ok · mongo ${h.mongo}`))
  .catch(() => (status.textContent = 'server offline'));
