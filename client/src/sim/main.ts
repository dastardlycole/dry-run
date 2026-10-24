import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CENTRE } from '../config';
import { Director } from '../examiner/director';
import { END_FAIL, END_PASS, routeDirections } from '../examiner/phrases';
import { PullUp } from '../examiner/pullup';
import { Voice } from '../examiner/voice';
import { FaultEngine, toFaultEvent, type SessionInfo } from '../faults/engine';
import { speedLimitAt } from '../faults/limits';
import { countFaults, resultOf } from '../faults/result';
import { RULE_NAMES, type Contact, type Fault, type Frame } from '../faults/types';
import { streamDebrief } from '../net/debrief';
import { fetchSummaryAudio } from '../net/summary-audio';
import { Sync } from '../net/sync';
import { GuideArrows, LightHeads, loadRoute, routeLinesMesh } from '../world/furniture';
import { buildSiteLights, signalSites, TrafficLights } from '../world/lights';
import { headingOf, pointAlong } from '../world/geometry';
import { Look } from '../world/look';
import { RouteProgress } from '../world/progress';
import { streetDetails } from '../world/street';
import { greenAreas, loadScenery, placeTrees, Trees, TREE_SHAPES } from '../world/scenery';
import { makeProjection } from '../world/projection';
import { addBuildingColliders, addParkedCars } from '../world/solids';
import { setAnisotropy } from '../world/textures';
import { buildWorld, emptyWorld, groundHalfM, loadWorld } from '../world/world';
import { Cameras } from './camera';
import { Car, WHEELBASE_M } from './car';
import { loadCarAsset } from '../world/car-asset';
import { Contacts } from './contacts';
import { MPH_PER_MS, toggleIndicator, type Indicator } from './controls';
import { Hud } from './hud';
import { Input } from './input';
import { placeOf } from './place';
import type { DebriefView } from './fault-list';
import { PauseScreen } from './pause-screen';
import { ResultScreen, type ResultFault } from './result-screen';

// The drivable car in the OSM world around the test centre (SPEC §4.1, §4.2).
const PHYSICS_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

await RAPIER.init();

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const look = new Look(renderer, scene);
setAnisotropy(renderer);

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
// Parks, water and trees are looks only: they come in the background and the drive never waits for them.
let trees: Trees | null = null;
loadScenery(CENTRE.id)
  .then(async (scenery) => {
    scene.add(greenAreas(scenery), streetDetails(worldData, scenery));
    trees = await Trees.create(placeTrees(worldData, scenery, TREE_SHAPES), renderer);
    scene.add(trees.group);
  })
  .catch((err) => console.warn('[scenery] not loaded, driving without it', err));
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
// The car model (with its interior) comes in the background; until then the car is the one built in code.
loadCarAsset('/models/corolla.glb', WHEELBASE_M)
  .then((model) => car.useModel(model))
  .catch((err) => console.warn('[car] model not loaded, keeping the built-in car', err));
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
const pauseScreen = new PauseScreen();
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
/** This test's faults, for the pause and result screens. */
let found: { id: string; fault: Fault; place: string }[] = [];
const foundRows = (): ResultFault[] => found.map(({ id, fault: f, place }) => ({ ...f, id, place }));
/** How many times, and how far apart, to ask again for explanations that weren't ready. */
const NOT_READY_RETRIES = 2;
const NOT_READY_RETRY_MS = 5000;
/** Stops the debrief stream on screen (unpaused, R pressed, or a new test). */
let debriefAbort: AbortController | null = null;
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
  if (paused) setPaused(false);
  voice.stop();
  const counts = countFaults(found.map((f) => f.fault));
  const result = resultOf(counts);
  resultScreen.show(result, counts, foundRows());
  voice.say(result === 'PASS' ? END_PASS : END_FAIL);
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
  showDebrief(saved.sessionId);
};

/** The examiner's debrief, asked for once the server has the whole test. The result screen is already up. */
function showDebrief(sessionId: string) {
  if (found.length && resultScreen.debrief) streamDebriefInto(resultScreen.debrief, sessionId, { onSummary: (text, signal) => saySummary(sessionId, text, signal) });
}

/** Reads the summary out after the result, in the Gemini voice if its audio comes in time, else the browser's. */
function saySummary(sessionId: string, text: string, signal: AbortSignal) {
  void fetchSummaryAudio(sessionId, signal).then((audio) => {
    // R was pressed (or another stream started) while it was on its way.
    if (signal.aborted) return;
    if (audio) voice.sayAudio(text, audio);
    else voice.sayUncaptioned(text);
  });
}

/**
 * Streams the debrief into the pause or result screen, stopping any earlier stream. Most of it is already
 * written: the server explains each fault in the background as soon as it's saved. `first` runs before asking;
 * `onSummary` gets the examiner's summary once, with a signal that says when the stream was stopped.
 */
function streamDebriefInto(
  view: DebriefView,
  sessionId: string,
  { first, onSummary }: { first?: () => Promise<void>; onSummary?: (text: string, signal: AbortSignal) => void } = {},
) {
  debriefAbort?.abort();
  const abort = (debriefAbort = new AbortController());
  let hadSummary = false;
  view.started();
  void (async () => {
    await first?.();
    // Explanations that failed for a passing reason (timeout, say) are asked for again, a couple of times.
    for (let round = 0; round <= NOT_READY_RETRIES && !abort.signal.aborted; round++) {
      if (round) await new Promise((r) => setTimeout(r, NOT_READY_RETRY_MS));
      if (abort.signal.aborted) return;
      let unavailable = false;
      const ok = await streamDebrief(
        sessionId,
        (line) => {
          if (line.kind === 'done') unavailable = line.unavailable;
          else view.set(line);
          // A retry round sends the summary again; it's only read out once.
          if (line.kind === 'summary' && !hadSummary) {
            hadSummary = true;
            onSummary?.(line.text, abort.signal);
          }
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      view.ended(ok, unavailable);
      if (!ok || unavailable || !view.hasNotReady) return;
    }
  })();
}

function stopDebrief() {
  debriefAbort?.abort();
  debriefAbort = null;
}

/** Sends what's queued for the test now, so the pause screen asks about every fault. Offline, it gives up at once. */
async function sendNow(sessionId: string) {
  await sync.flush();
  // A send that was already under way may have started before the last faults were queued.
  if (sync.pendingFor(sessionId) && sync.state !== 'offline') await sync.flush();
}

/** Pausing shows the test so far: stats, and the faults with whatever of the debrief is ready. */
function setPaused(on: boolean) {
  paused = on;
  if (!on) {
    pauseScreen.hide();
    stopDebrief();
    return;
  }
  pauseScreen.show(simTime, countFaults(found.map((f) => f.fault)), foundRows());
  const s = session;
  if (s && found.length && pauseScreen.debrief) streamDebriefInto(pauseScreen.debrief, s.sessionId, { first: () => sendNow(s.sessionId) });
}
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
    // The result screen is its own pause.
    if (action === 'pause') {
      if (!resultScreen.visible) setPaused(!paused);
    }
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
      stopDebrief();
      // An unfinished test is saved as ended here, with the faults so far. A new one starts on the next frame.
      if (session && !ended) sync.endSession(session.sessionId, new Date().toISOString(), true);
      session = null;
      ended = false;
      faultCount = 0;
      found = [];
      contacts.clear();
      trace.length = 0;
      // Each drive's clock (the pause screen's time driven, fault times) and the light cycle start again.
      simTime = 0;
      acc = 0;
      // Reset while paused: the pause screen starts afresh too.
      if (paused) setPaused(true);
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
  look.follow(car.mesh.position);
  trees?.update(car.mesh.position);
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
        found.push({ id: event._id, fault: f, place: placeOf(f, route!.steps, worldData.roads) });
        sync.addFault(event);
      }
      if (pullUp!.update(simTime, m, car.speedMph, director!.finished)) endDrive();
    }
  }
  cameras.update({ lookLeft: input.lookLeft, lookRight: input.lookRight, mirror: input.mirror }, dt);
  hud.update({ speedMph: car.speedMph, gear: car.gear, indicator, camera: cameras.mode, paused }, now);
  renderer.shadowMap.needsUpdate = true;
  cameras.render(renderer, scene);
});

// Handy for poking at the sim from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, {
    sim: {
      car, input, world, cameras, renderer, scene, route, lights, progress, voice, time: () => simTime,
      /** Puts the car `m` metres along the demo route, facing along it (for checking how places look). */
      goto(m: number) {
        if (!route) return;
        const { p, dir } = pointAlong(route.line, m);
        car.setStart(p[0], p[1], headingOf(dir[0], dir[1]));
        car.reset();
        // R still goes back to the test centre.
        car.setStart(route.start.pos[0], route.start.pos[1], route.start.heading);
      },
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
