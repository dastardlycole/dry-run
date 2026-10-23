import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CENTRE } from '../config';
import { Director } from '../examiner/director';
import { routeDirections } from '../examiner/phrases';
import { PullUp } from '../examiner/pullup';
import { Voice } from '../examiner/voice';
import { FaultEngine, toFaultEvent, type SessionInfo } from '../faults/engine';
import { speedLimitAt } from '../faults/limits';
import { countFaults, resultOf } from '../faults/result';
import { RULE_NAMES, type Contact, type Fault, type Frame } from '../faults/types';
import { Sync } from '../net/sync';
import { GuideArrows, LightHeads, loadRoute, routeLinesMesh } from '../world/furniture';
import { buildSiteLights, signalSites, TrafficLights } from '../world/lights';
import { RouteProgress } from '../world/progress';
import { makeProjection } from '../world/projection';
import { addBuildingColliders, addParkedCars } from '../world/solids';
import { buildWorld, emptyWorld, groundHalfM, loadWorld } from '../world/world';
import { Cameras } from './camera';
import { Car } from './car';
import { Contacts } from './contacts';
import { MPH_PER_MS, toggleIndicator, type Indicator } from './controls';
import { Hud } from './hud';
import { Input } from './input';
import { placeOf } from './place';
import { ResultScreen, type ResultFault } from './result-screen';

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
/** What each solid thing is, by collider handle, for R11. */
const solidKind = new Map<number, Contact>();
const buildingCollider = addBuildingColliders(world, worldData);
if (buildingCollider) solidKind.set(buildingCollider.handle, 'building');

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
  for (const c of addParkedCars(world, scene, route.parkedCars)) solidKind.set(c.handle, 'parkedCar');
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

// Examiner directions and the fault engine (SPEC §4.4–4.6). Both only follow the demo route.
const voice = new Voice();
voice.onSpeak = (text) => hud.showCaption(text);
const director = route ? new Director(routeDirections(route)) : null;
const edgeById = new Map(worldData.graph.edges.map((e) => [e.id, e]));
const routeEdges = route ? route.edges.flatMap((id) => edgeById.get(id) ?? []) : [];
const roadByWay = new Map(worldData.roads.map((r) => [r.wayId, r]));
const faults = route
  ? new FaultEngine({
      steps: route.steps,
      lightFor: (edgeId, t) => lights.stateFor(edgeId, t),
      junctions: worldData.junctions,
      roadFor: (edgeId) => roadByWay.get(edgeById.get(edgeId)?.wayId ?? -1),
    })
  : null;
const pullUp = route ? new PullUp(route.lengthM) : null;
const toLatLng = makeProjection(CENTRE.lat, CENTRE.lng).toLatLng;

// Sessions and faults go to the server in the background (SPEC §9); the drive never waits for it.
const sync = new Sync();
sync.start();
const resultScreen = new ResultScreen(route?.line ?? []);
/** One per browser, kept between visits. There are no accounts. */
const learnerId = (() => {
  const KEY = 'dryrun.learnerId';
  try {
    const id = localStorage.getItem(KEY) ?? `learner-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `learner-${crypto.randomUUID()}`;
  }
})();
/** The test in progress: null before the first key press, and between a reset and the next frame. */
let session: SessionInfo | null = null;
let ended = false;
let faultCount = 0;
/** This test's faults, for the result screen. */
let found: { fault: Fault; place: string }[] = [];
const contacts = new Contacts();

function openSession() {
  const now = Date.now();
  // Fault times are this session's start plus sim time (startedAtMs is when sim time was 0), so a
  // replayed trace gives the same times. Sim time stops while paused, so they can run a little early.
  session = { sessionId: crypto.randomUUID(), learnerId, centreId: CENTRE.id, startedAtMs: now - simTime * 1000 };
  sync.startSession({
    sessionId: session.sessionId,
    learnerId,
    centreId: CENTRE.id,
    routeId: route!.id,
    startedAt: new Date(now).toISOString(),
  });
}

/** The drive is over (pulled up, or Enter): show the result from local faults, and save it behind the scenes. */
function endDrive() {
  if (!session || ended) return;
  ended = true;
  voice.stop();
  const counts = countFaults(found.map((f) => f.fault));
  const rows: ResultFault[] = found.map(({ fault: f, place }) => ({ ...f, place }));
  resultScreen.show(resultOf(counts), counts, rows);
  sync.endSession(session.sessionId, new Date().toISOString());
  showSaveState();
}

/** The line on the result screen about saving; the server's own result replaces it once saved. */
function showSaveState() {
  if (!session || !resultScreen.visible || !sync.pendingFor(session.sessionId)) return;
  resultScreen.setSave(sync.state === 'offline' ? 'Server offline: the result will be saved when it is back.' : 'Saving to Atlas…');
}
sync.onState = showSaveState;
sync.onSaved = (saved) => {
  if (session?.sessionId !== saved.sessionId || !resultScreen.visible) return;
  resultScreen.setSave(`Saved to Atlas · server result ${saved.result} · session ${saved.sessionId.slice(0, 8)}`);
};
sync.onFailed = (id) => {
  if (session?.sessionId === id && resultScreen.visible) resultScreen.setSave("Couldn't save this test: the server refused it.");
};

/** Frames since the last reset, so a real drive can be saved as a test trace (dev only). */
const trace: Frame[] = [];
/** About 15 minutes at 60 fps: plenty for the demo route, without growing forever in an idle tab. */
const MAX_TRACE_FRAMES = 54_000;
/** The examiner waits for the first key press or click: browsers block sound until then. */
let started = false;
const start = () => (started = true);
window.addEventListener('keydown', start, { once: true });
window.addEventListener('pointerdown', start, { once: true });

/** The car started touching something (not the ground). The fault engine marks it as R11. */
function onCollision(handle: number) {
  contacts.start(handle, solidKind.get(handle) ?? 'other');
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
    else if (action === 'end') endDrive();
    else if (action === 'reset') {
      car.reset();
      progress?.reset();
      indicator = 'off';
      faults?.reset();
      director?.reset();
      pullUp?.reset();
      voice.stop();
      hud.clearFaults();
      resultScreen.hide();
      // An unfinished test is saved as ended here, with the faults so far. A new one starts on the next frame.
      if (session && !ended) sync.endSession(session.sessionId, new Date().toISOString());
      session = null;
      ended = false;
      faultCount = 0;
      found = [];
      contacts.clear();
      trace.length = 0;
    } else if (!paused) indicator = toggleIndicator(indicator, action === 'indicateLeft' ? 'left' : 'right');
  }

  if (!paused) {
    acc += dt;
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
      car.update(input.drive(), PHYSICS_DT);
      world.step(events);
      events.drainCollisionEvents((h1, h2, started) => {
        const carHandle = car.collider.handle;
        if (h1 !== carHandle && h2 !== carHandle) return;
        const other = h1 === carHandle ? h2 : h1;
        // The body scraping the ground (hard braking, bumps) isn't a crash.
        if (other === groundCollider.handle) return;
        if (started) onCollision(other);
        else contacts.stop(other);
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
  if (progress) {
    const pos: [number, number] = [car.mesh.position.x, car.mesh.position.z];
    const m = progress.update(pos);
    guide?.show(m);
    if (started && !paused && !ended) {
      if (!session) openSession();
      for (const text of director!.update(m, car.speedMph / MPH_PER_MS, progress.offM)) voice.say(text);
      const frame: Frame = {
        t: simTime,
        pos,
        speedMph: car.speedMph,
        indicator,
        mirror: input.takeMirrorCheck(),
        routeM: m,
        offRouteM: progress.offM,
        sideM: progress.sideM,
        contact: contacts.take(),
        limitMph: speedLimitAt(pos, routeEdges),
      };
      if (import.meta.env.DEV && trace.length < MAX_TRACE_FRAMES) trace.push(frame);
      for (const f of faults!.step(frame)) {
        const event = toFaultEvent(f, ++faultCount, session!, toLatLng);
        console.log(`[fault] ${f.ruleId} ${RULE_NAMES[f.ruleId]} (${f.category})`, event);
        hud.flashFault(`${f.ruleId} · ${RULE_NAMES[f.ruleId]}`, f.category);
        found.push({ fault: f, place: placeOf(f, route!.steps, worldData.roads) });
        sync.addFault(event);
      }
      if (pullUp!.update(simTime, m, car.speedMph, director!.finished)) endDrive();
    }
  }
  cameras.update({ lookLeft: input.lookLeft, lookRight: input.lookRight, mirror: input.mirror }, dt);
  hud.update({ speedMph: car.speedMph, gear: car.gear, indicator, camera: cameras.mode, paused }, now);
  cameras.render(renderer, scene);
});

// Handy for poking at the sim from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, {
    sim: {
      car, input, world, cameras, renderer, scene, route, lights, progress, voice, time: () => simTime,
      /** Downloads the drive since the last reset as a Frame[] JSON, for use as a fault test trace. */
      saveTrace() {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(trace)], { type: 'application/json' }));
        a.download = `trace-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`;
        a.click();
      },
    },
  });

const status = document.querySelector('#status')!;
fetch('/api/health')
  .then((r) => r.json())
  .then((h) => (status.textContent = `${mapNote}server ok · mongo ${h.mongo}`))
  .catch(() => (status.textContent = `${mapNote}server offline`));
