import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CENTRE } from '../config';
import { GuideArrows, LightHeads, loadRoute, routeLinesMesh } from '../world/furniture';
import { buildSiteLights, signalSites, TrafficLights } from '../world/lights';
import { RouteProgress } from '../world/progress';
import { addBuildingColliders, addParkedCars } from '../world/solids';
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

// Roads are flat at ground level, so one ground collider carries the car everywhere (SPEC §4.1).
const groundHalf = groundHalfM(CENTRE.radiusM);
const groundCollider = world.createCollider(
  RAPIER.ColliderDesc.cuboid(groundHalf, 0.1, groundHalf).setTranslation(0, -0.1, 0),
);
// If the map can't load, keep going on plain grass so the car still drives.
let mapNote = '';
const [worldData, route] = await Promise.all([
  loadWorld(CENTRE.id).catch((err) => {
    console.error('[world] failed to load, using empty world', err);
    mapNote = 'map failed to load · ';
    return emptyWorld(CENTRE);
  }),
  // Without a route the car still drives, from the nearest main road to the centre.
  loadRoute(CENTRE.id, 'demo').catch((err) => {
    console.error('[route] failed to load', err);
    mapNote += 'route failed to load · ';
    return null;
  }),
]);
const roadStart = buildWorld(worldData, scene);
addBuildingColliders(world, worldData);

const highwayOf = new Map(worldData.roads.map((r) => [r.wayId, r.highway]));
const lights = new TrafficLights(
  buildSiteLights(signalSites(worldData.junctions), worldData.graph.edges, (e) => highwayOf.get(e.wayId) === 'service'),
);
const lightHeads = new LightHeads(scene, lights.sites, worldData);

let guide: GuideArrows | null = null;
const progress = route ? new RouteProgress(route) : null;
if (route) {
  scene.add(routeLinesMesh(route));
  guide = new GuideArrows(route);
  scene.add(guide.mesh);
  addParkedCars(world, scene, route.parkedCars);
}

const car = new Car(world, scene);
if (route) car.setStart(route.start.pos[0], route.start.pos[1], route.start.heading);
else car.setStart(roadStart.x, roadStart.z, roadStart.heading);
car.reset();
/** Seconds of driving so far (stops while paused); the traffic lights run on this. */
let simTime = 0;
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
    else if (action === 'guide') {
      if (guide) guide.mesh.visible = !guide.mesh.visible;
    }
    else if (action === 'reset') {
      car.reset();
      progress?.reset();
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
      simTime += PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0; // fell behind; don't spiral
  }

  car.sync();
  car.mesh.updateMatrixWorld();
  lightHeads.update(simTime);
  if (progress && guide) guide.show(progress.update([car.mesh.position.x, car.mesh.position.z]));
  cameras.update({ lookLeft: input.lookLeft, lookRight: input.lookRight, mirror: input.mirror }, dt);
  hud.update({ speedMph: car.speedMph, gear: car.gear, indicator, camera: cameras.mode, paused }, now);
  cameras.render(renderer, scene);
});

// Handy for poking at the sim from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { sim: { car, input, world, cameras, renderer, scene, route, lights, progress, time: () => simTime } });

const status = document.querySelector('#status')!;
fetch('/api/health')
  .then((r) => r.json())
  .then((h) => (status.textContent = `${mapNote}server ok · mongo ${h.mongo}`))
  .catch(() => (status.textContent = `${mapNote}server offline`));
