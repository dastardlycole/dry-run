import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CENTRE } from '../config';
import { Director } from '../examiner/director';
import { END_FAIL, END_PASS, END_UNFINISHED, routeDirections } from '../examiner/phrases';
import { OffRoute } from '../examiner/off-route';
import { PullUp } from '../examiner/pullup';
import { tellMeFault, type TellMeAnswer } from '../examiner/tell-me';
import { TellMe } from '../examiner/tell-me-live';
import { PRACTICE_OPENING, tipFor } from '../examiner/tips';
import { Voice } from '../examiner/voice';
import { EngineSound } from './engine-sound';
import { FaultEngine, toFaultEvent, type SessionInfo } from '../faults/engine';
import { speedLimitAt } from '../faults/limits';
import { countFaults, drivingFaultLimit, resultOf } from '../faults/result';
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
import { ExaminerPanel, fetchExplanation } from './examiner-panel';
import { centreFiles, CentrePicker, modeOf } from './centre-picker';
import { Car, WHEELBASE_M } from './car';
import { loadCarAsset } from '../world/car-asset';
import { Contacts } from './contacts';
import { MPH_PER_MS, toggleIndicator, type Indicator } from './controls';
import { Hud } from './hud';
import { Input } from './input';
import { areaOf, placeOf, roadAt } from './place';
import type { DebriefView } from './fault-list';
import { PauseScreen } from './pause-screen';
import { repeatFromM, startBeforeM } from './repeat';
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

// Which centre: ?centre=goodmayes (one the start box built); default Wanstead. Which route: ?route=auto-2
// picks one (route-<id>.json); default the demo at Wanstead, the first generated one elsewhere.
const params = new URLSearchParams(location.search);
const centreId = params.get('centre')?.replace(/[^a-z0-9-]/g, '') || CENTRE.id;
const where =
  centreId === CENTRE.id ? { base: `/${CENTRE.id}`, routes: ['demo', 'auto-1', 'auto-2', 'auto-3', 'auto-4'] } : await centreFiles(centreId);
const routeId = params.get('route')?.replace(/[^\w-]/g, '') || where.routes[0] || 'auto-1';
// A mock test (the default), or practice (?mode=practice): an instructor gives a tip at each fault and there's
// no pass or fail. ?mode=free is practice with no route.
const mode = modeOf(params.get('mode'));
const coaching = mode !== 'test';
if (coaching) document.getElementById('help-end')!.textContent = 'drive';
document.getElementById('help-repeat')!.hidden = mode !== 'practice';
// Always on screen, so it's clear whether this drive is being marked like a test.
const badge = document.getElementById('mode-badge')!;
badge.className = mode;
badge.textContent = { test: 'Mock test', practice: 'Practice', free: 'Free drive' }[mode];
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
// If the map can't load, keep going on plain grass so the car still drives.
let mapNote = '';
// Until a route is chosen, the start card asks where the learner's test is and which route to drive; the
// centre's first route drives behind it meanwhile. Links straight to a route (?route=auto-2) skip it.
const picker = new CentrePicker({
  id: centreId,
  // A picked centre's real name comes with its map, below.
  name: centreId === CENTRE.id ? CENTRE.name : centreId.replace(/(^|-)([a-z])/g, (_, dash, c) => `${dash && ' '}${c.toUpperCase()}`),
  base: where.base,
  routeIds: where.routes,
  routeId,
  picked: params.has('centre'),
  mode,
  learnerId,
});
if (!params.has('route') && mode !== 'free') picker.show();
picker.onHide = () => input.clear();
// "Change route" (top, beside the road name) and the link in the help line open the card for this centre.
const changeRoute = (e: MouseEvent) => {
  // Ctrl/Shift/middle-click on the link still opens the start page in a new tab.
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).blur(); // so Space (handbrake) doesn't press it again
  picker.show();
};
document.getElementById('change-route')!.addEventListener('click', changeRoute);
document.getElementById('change-centre')!.addEventListener('click', changeRoute);
const [worldData, route] = await Promise.all([
  loadWorld(where.base).catch((err) => {
    console.error('[world] failed to load, using empty world', err);
    mapNote = 'map failed to load · ';
    // Still the centre that was picked, so its drives aren't saved as Wanstead ones.
    return emptyWorld({ ...CENTRE, id: centreId, name: centreId });
  }),
  // Without a route the car still drives, from the nearest main road to the centre.
  mode === 'free' ? null : loadRoute(where.base, routeId).catch((err) => {
    console.error('[route] failed to load', err);
    mapNote += 'route failed to load · ';
    return null;
  }),
]);
const centre = worldData.centre;
if (!mapNote.startsWith('map failed')) picker.named(centre.name);
// Roads are flat at ground level, so one ground collider carries the car everywhere (SPEC §4.1).
const groundHalf = groundHalfM(centre.radiusM);
const groundCollider = world.createCollider(
  RAPIER.ColliderDesc.cuboid(groundHalf, 0.1, groundHalf).setTranslation(0, -0.1, 0),
);
const roadStart = buildWorld(worldData, scene);
// Parks, water and trees are looks only: they come in the background and the drive never waits for them.
let trees: Trees | null = null;
loadScenery(where.base)
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
const engine = new EngineSound();
/** No engine or indicator sound right now (see the frame loop). */
let carQuiet = true;
hud.onBlink = (on) => {
  if (!carQuiet) engine.tick(on);
};
const examinerPanel = new ExaminerPanel();
// The place line at the top: the road the car is on and the area. Looked up twice a second, not every frame
// (thousands of road pieces); on an unnamed road it keeps the last name.
const area = areaOf(centre.name, centre.address);
let placeAt = 0;
let roadName = '';
let indicator: Indicator = 'off';
let paused = false;

// Examiner directions and the fault engine (SPEC §4.4–4.6). Both only follow the demo route.
const voice = new Voice();
voice.onSpeak = (text) => hud.showCaption(text);
const director = route ? new Director(routeDirections(route)) : null;
// From a weak junction's Practise button (?at=): start just before that junction, where J would put the car.
const startAtM = mode === 'practice' && route ? startBeforeM(route.steps, params.get('at') ?? '') : null;
if (startAtM !== null) {
  placeAlongRoute(startAtM);
  progress!.jumpTo(startAtM);
}
const edgeById = new Map(worldData.graph.edges.map((e) => [e.id, e]));
const routeEdges = route ? route.edges.flatMap((id) => edgeById.get(id) ?? []) : [];
const roadByWay = new Map(worldData.roads.map((r) => [r.wayId, r]));
// With no route (free drive) only the rules that don't need one can mark anything: speed, mirror before
// signalling, moving off and collisions.
const faults = new FaultEngine({
  steps: route?.steps ?? [],
  lightFor: (edgeId, t) => lights.stateFor(edgeId, t),
  junctions: worldData.junctions,
  roadFor: (edgeId) => roadByWay.get(edgeById.get(edgeId)?.wayId ?? -1),
});
/** Free drive: the speed limit where the car is, looked up from every road twice a second, not every frame. */
let freeLimitMph = 30;
const pullUp = route ? new PullUp(route.lengthM) : null;
const offRoute = route ? new OffRoute() : null;
const toLatLng = makeProjection(centre.lat, centre.lng).toLatLng;

// Sessions and faults go to the server in the background (SPEC §9); the drive never waits for it.
const sync = new Sync();
sync.start();
/** A mock test is shorter than the real 40 minutes, so the pass mark is scaled to the route (3 km allows 4). */
const maxDriving = drivingFaultLimit(route?.lengthM);
const resultScreen = new ResultScreen(route?.line ?? [], maxDriving);
const pauseScreen = new PauseScreen(coaching ? null : maxDriving);
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
  session = { sessionId: crypto.randomUUID(), learnerId, centreId: centre.id, startedAtMs: now - simTime * 1000 };
  sync.startSession({
    sessionId: session.sessionId,
    learnerId,
    centreId: centre.id,
    routeId: route?.id ?? 'free',
    ...(coaching ? { mode } : {}),
    startedAt: new Date(now).toISOString(),
  });
  if (coaching) voice.say(PRACTICE_OPENING);
  // The 'tell me' question came first; a wrong answer is this test's first fault.
  const fault = tellMeAnswer && tellMeFault(tellMeAnswer, simTime, route?.start.pos ?? [car.mesh.position.x, car.mesh.position.z]);
  if (fault) recordFault(fault, 'before setting off');
}

/** A fault for this test: on screen, in the lists, and off to the server. */
function recordFault(f: Fault, place: string) {
  const event = toFaultEvent(f, ++faultCount, session!, toLatLng);
  console.log(`[fault] ${f.ruleId} ${RULE_NAMES[f.ruleId]} (${f.category})`, event);
  hud.flashFault(`${f.ruleId} · ${RULE_NAMES[f.ruleId]}`, f.category);
  // Practice: the instructor says what to do about it straight away (a fixed tip per rule, never the AI's).
  if (coaching) voice.sayTip(tipFor(f));
  found.push({ id: event._id, fault: f, place });
  sync.addFault(event);
  showNote(event._id, f, place);
}

/** The examiner's notes, top right: the fault now, its explanation once the server has written it (in the background). */
function showNote(faultId: string, f: Fault, place: string) {
  const signal = examinerPanel.show(faultId, f.ruleId, f.category, place);
  const s = session!;
  void (async () => {
    // The fault has to be on the server before its explanation can be asked for.
    await sendNow(s.sessionId);
    const explanation = await fetchExplanation(s.sessionId, faultId, signal);
    if (!signal.aborted) examinerPanel.explain(faultId, explanation);
  })();
}

/**
 * The drive is over (pulled up, or Enter): show the result from local faults, and save it behind the scenes.
 * Ending before the examiner has asked to pull up is a test not finished, never a pass.
 */
function endDrive() {
  if (!session || ended) return;
  ended = true;
  if (paused) setPaused(false);
  examinerPanel.hide();
  voice.stop();
  const finished = director?.finished ?? false;
  const counts = countFaults(found.map((f) => f.fault));
  if (coaching) {
    // Practice has no pass or fail: just the faults to work on.
    resultScreen.show(null, counts, foundRows(), tellMeAnswer);
  } else {
    const result = resultOf(counts, finished, maxDriving);
    resultScreen.show(result, counts, foundRows(), tellMeAnswer);
    voice.say(result === 'PASS' ? END_PASS : result === 'FAIL' ? END_FAIL : END_UNFINISHED);
  }
  sync.endSession(session.sessionId, new Date().toISOString(), finished ? 'finished' : 'unfinished');
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
  const what = coaching ? 'practice drive' : `server result ${saved.result}`;
  resultScreen.setSave(`Saved to Atlas · ${what} · session ${saved.sessionId.slice(0, 8)}`);
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
const start = () => (started ||= !picker.visible);
window.addEventListener('keydown', start);
window.addEventListener('pointerdown', start);
/** The 'tell me' question before each test (SPEC §4.5 FR-E3). The drive starts once it's answered or skipped. */
const tellMe = new TellMe();
/** This test's 'tell me' answer, or null if it was skipped. */
let tellMeAnswer: TellMeAnswer | null = null;
tellMe.onSettled = (answer) => {
  tellMeAnswer = answer;
  // The test starts now: time spent on the question isn't driving time (fault times, lights, time driven).
  simTime = 0;
  acc = 0;
};

/** The car started touching something (not the ground). The fault engine marks it as R11. */
function onCollision(handle: number) {
  contacts.start(handle, solidKind.get(handle) ?? 'other');
  hud.flashCollision();
}

/**
 * Practice: puts the car back on the approach to the last junction it passed, to have another go. The
 * direction for it is given again and the junction is judged again; the faults so far stay.
 */
function repeatJunction() {
  if (!route) return;
  const back = repeatFromM(route.steps, progress!.m);
  if (back === null) return;
  placeAlongRoute(back);
  progress!.jumpTo(back);
  director!.rewind(back);
  faults.rewind();
  pullUp?.reset();
  offRoute?.reset();
  indicator = 'off';
  contacts.clear();
  // Anything being said goes on: most likely the tip for the fault that made the learner want another go.
}

/** Puts the car `m` metres along the route, facing along it. R still goes back to the test centre. */
function placeAlongRoute(m: number) {
  if (!route) return;
  const { p, dir } = pointAlong(route.line, m);
  car.setStart(p[0], p[1], headingOf(dir[0], dir[1]));
  car.reset();
  car.setStart(route.start.pos[0], route.start.pos[1], route.start.heading);
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

  // While the start card is open the drive hasn't begun: nothing moves and the examiner waits.
  const choosing = picker.visible;
  for (const action of input.takeActions()) {
    if (choosing) continue;
    // The result screen is its own pause.
    if (action === 'pause') {
      if (!resultScreen.visible) setPaused(!paused);
    }
    else if (action === 'camera') cameras.toggle();
    else if (action === 'engineSound') engine.muted = !engine.muted;
    else if (action === 'guide') {
      if (guide) guide.mesh.visible = !guide.mesh.visible;
    }
    else if (action === 'end') endDrive();
    else if (action === 'repeat') {
      if (mode === 'practice' && !paused && !ended) repeatJunction();
    }
    else if (action === 'reset') {
      car.reset();
      progress?.reset();
      indicator = 'off';
      faults.reset();
      director?.reset();
      pullUp?.reset();
      offRoute?.reset();
      voice.stop();
      hud.clearFaults();
      resultScreen.hide();
      stopDebrief();
      examinerPanel.hide();
      // A test reset part-way is saved as ended here (UNFINISHED), with the faults so far. A new one starts on the next frame.
      if (session && !ended) sync.endSession(session.sessionId, new Date().toISOString(), 'abandoned');
      session = null;
      ended = false;
      faultCount = 0;
      found = [];
      contacts.clear();
      trace.length = 0;
      tellMeAnswer = null;
      tellMe.offer();
      // Each drive's clock (the pause screen's time driven, fault times) and the light cycle start again.
      simTime = 0;
      acc = 0;
      // Reset while paused: the pause screen starts afresh too.
      if (paused) setPaused(true);
    } else if (!paused) indicator = toggleIndicator(indicator, action === 'indicateLeft' ? 'left' : 'right');
  }

  if (!paused && !choosing) {
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
  {
    const pos: [number, number] = [car.mesh.position.x, car.mesh.position.z];
    const m = progress?.update(pos) ?? 0;
    guide?.show(m);
    if (started && !tellMe.busy && !paused && !choosing && !ended) {
      if (!session) openSession();
      if (director) for (const text of director.update(m, car.speedMph / MPH_PER_MS, progress!.offM)) voice.say(text);
      const lost = offRoute?.update(simTime, progress!.offM);
      if (lost) voice.say(lost);
      const frame: Frame = {
        t: simTime,
        pos,
        speedMph: car.speedMph,
        indicator,
        mirror: input.takeMirrorCheck(),
        ...input.takeLooks(),
        routeM: m,
        offRouteM: progress?.offM ?? 0,
        sideM: progress?.sideM ?? 0,
        contact: contacts.take(),
        limitMph: route ? speedLimitAt(pos, routeEdges) : freeLimitMph,
      };
      if (import.meta.env.DEV && trace.length < MAX_TRACE_FRAMES) trace.push(frame);
      for (const f of faults.step(frame)) recordFault(f, placeOf(f, route?.steps ?? [], worldData.roads));
      if (pullUp?.update(simTime, m, car.speedMph, director!.finished)) endDrive();
    }
  }
  cameras.update({ lookLeft: input.lookLeft, lookRight: input.lookRight, mirror: input.mirror }, dt);
  if (now - placeAt > 500) {
    placeAt = now;
    roadName = roadAt(worldData.roads, [car.mesh.position.x, car.mesh.position.z], roadName) || roadName;
    hud.showPlace(roadName ? `${roadName} · ${area}` : area);
    if (!route) freeLimitMph = speedLimitAt([car.mesh.position.x, car.mesh.position.z], worldData.graph.edges);
  }
  // Silent while nothing is being driven, and during the 'tell me' question so the mic hears only the learner.
  carQuiet = paused || choosing || resultScreen.visible || tellMe.busy;
  hud.update({ speedMph: car.speedMph, gear: car.gear, indicator, camera: cameras.mode, paused }, now);
  {
    const pedals = input.drive();
    const pressing = car.gear === 'D' ? pedals.throttle : pedals.brake;
    engine.update(car.speedMph, pressing, voice.talking, carQuiet);
  }
  renderer.shadowMap.needsUpdate = true;
  cameras.render(renderer, scene);
});

// Handy for poking at the sim from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, {
    sim: {
      car, input, world, cameras, renderer, scene, route, lights, progress, voice, engine, time: () => simTime,
      /** Puts the car `m` metres along the demo route, facing along it (for checking how places look). */
      goto: placeAlongRoute,
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
  .then((h) => (status.textContent = `${centre.name} · ${route?.name ?? 'free drive'} · ${mapNote}server ok · mongo ${h.mongo}`))
  .catch(() => (status.textContent = `${centre.name} · ${mapNote}server offline`));
