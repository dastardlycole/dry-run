# Dry Run — Requirements Specification

Version 0.2 · 23 Oct 2026 · Encode London hackathon build

> **Rule:** all code is written during the hackathon. Libraries and starter templates are fine.
> **Priority tags:** **[P0]** = MVP, must work to submit · **[P1]** = should have, build once P0 is solid · **[P2]** = stretch, only if time allows.
> **Cut rule:** if P0 isn't working end to end by **Saturday 22:00**, stop all P1 work and fix P0.

---

## 1. Overview

**Dry Run** is a browser-based 3D simulator of the real roads around one UK driving test centre. A learner drives a test-style route while an **AI examiner** talks to them by voice: it greets them, asks the vehicle safety questions, gives directions, answers questions and debriefs them at the end. A deterministic fault engine marks the drive using DVSA-style categories. Every fault streams into MongoDB Atlas, building a crowdsourced map of where learners fail at that centre. Saint acts as the instructor's assistant.

**Problem:** the national car test pass rate was ~48.7% in 2024-25, average waits were ~22 weeks in April 2026, and the DVSA stopped publishing test routes in 2010. Learners go in without having practised the junctions that catch people out at their centre.

**Who pays:** learners (per mock test / subscription) and driving schools (instructor dashboard).

---

## 2. Sponsor tracks and how we score

| Track | Priority | What judges want | How Dry Run hits it |
|---|---|---|---|
| **MongoDB Atlas** | Primary | App relies on Atlas; more Atlas features = more points; 3-min video showing MongoDB in use | Atlas for all data + Stream Processing + Automated Embedding + Vector Search + Atlas Search + Hybrid Search + Voyage rerank + geospatial (§8) |
| **Saint** | Primary (if we have a Saint seat) | Cool factor, Saint actually doing the job, real-world use, human control | Saint emails reports and proposes lessons for the instructor, asking before acting (§4.9) |
| **Gemini 4 Argon bounty** | Secondary | Live demo with real inputs, real verification loop, named user, needs Argon, human control | Live voice examiner, Argon debrief with citation-checking verification loop, Argon adaptive routes (§9) |
| **The Real World (Encode)** | Secondary | Real user + problem, reads messy real-world data, honest uncertainty, privacy | Real OSM roads, handles OSM gaps, no real-user tracking |
| Agents That Ship (Encode) | Optional | Agent completes a real job end to end | Weak fit — only submit if Saint flow is strong |

Submission notes required per track are in §14.

---

## 3. Goals and non-goals

### Goals
- **[P0]** Drive a car in the browser around one real test centre, built from OpenStreetMap.
- **[P0]** Examiner gives spoken directions along a demo route.
- **[P0]** Deterministic fault engine with DVSA categories; PASS/FAIL result.
- **[P0]** Faults stored in Atlas; per-junction stats; heatmap.
- **[P0]** Debrief explaining each fault, grounded in DVSA guidance via RAG, with citations.
- **[P1]** Two-way conversational AI examiner (tell me / show me questions, answers questions).
- **[P1]** Instructor search (hybrid + rerank) and Saint workflow.
- **[P2]** Adaptive routes, independent driving, emergency stop, manoeuvres.

### Non-goals
- Realistic physics or manual gears. Mobile. Multiple centres (design allows it, build one). User accounts beyond a display name.
- **Booking or changing DVSA tests.** Illegal to do for someone else since May 2026; nothing in the system does this.

---

## 4. Functional requirements

### 4.1 World
- **[P0]** FR-W1. Load pre-processed map assets for one centre (centre lat/lng + ~2 km radius).
- **[P0]** FR-W2. Roads as 3D meshes with correct widths, lane markings, centre lines, give-way/stop lines.
- **[P0]** FR-W3. Roundabouts and traffic signals (with working light cycle) on the demo route.
- **[P0]** FR-W4. Buildings as extruded footprints (flat colours, instanced/merged meshes).
- **[P0]** FR-W5. Speed limits from OSM `maxspeed`; default 30 mph when missing.
- **[P0]** FR-W6. Road graph (junction nodes, directed lane edges) used by routing, traffic and fault detection.
- **[P0]** FR-W7. Stable junction IDs from OSM node IDs, so faults aggregate across sessions.
- **[P0]** FR-W8. Offline pre-processing script (`/tools/osm-import`); the browser never loads raw OSM.
- **[P0]** FR-W9. "© OpenStreetMap contributors" attribution visible.
- **[P1]** FR-W10. Pedestrian crossings (zebra, pelican) where tagged.
- **[P0] fallback:** if OSM lane geometry is unusable by **Sat 12:00**, hand-model the 4–5 junctions on the demo route and use OSM only for buildings/background.

### 4.2 Player vehicle
- **[P0]** FR-V1. Arcade car: accelerate, brake, steer, reverse. Speedometer in mph.
- **[P0]** FR-V2. Keyboard: Arrows/WASD drive · `Z`/`X` left/right indicator · `M` mirror check · `Q`/`E` look left/right · `Space` handbrake · `Esc` pause.
- **[P0]** FR-V3. First-person camera; `C` toggles chase cam.
- **[P0]** FR-V4. Mirror check and look left/right are explicit actions with visible camera movement.
- **[P0]** FR-V5. Collisions with buildings, kerbs, vehicles, pedestrians.
- **[P1]** FR-V6. "Show me" controls: `1` windscreen washers, `2` rear demister, `3` horn, `4` front demister, `5` headlights.
- **[P2]** FR-V7. Gamepad / steering wheel via the browser Gamepad API.

### 4.3 Traffic and hazards
- **[P0]** FR-T1. Traffic lights cycle; a few parked cars.
- **[P1]** FR-T2. 10–30 AI cars following the road graph, obeying lights, giving way, keeping distance.
- **[P1]** FR-T3. Scripted hazards on the demo route: pedestrian on crossing; car pulling out of side road; cyclist ahead.
- **[P1]** FR-T4. Fixed seed in demo mode for reproducible runs.

### 4.4 Route and directions
- **[P0]** FR-R1. Fixed scripted demo route from the centre and back, covering ≥1 roundabout, ≥1 signalled junction, ≥1 give-way junction.
- **[P0]** FR-R2. Directions generated from the route ("At the roundabout, take the third exit"), triggered by distance/speed so they're spoken ≥4 s before the manoeuvre.
- **[P0]** FR-R3. If the learner goes off-route, re-route and say so neutrally ("That's fine, take the next left").
- **[P1]** FR-R4. Generated routes (A* on the road graph) meeting the same coverage rules.
- **[P2]** FR-R5. **Adaptive route:** `gemini-4-argon` chooses a route weighted toward this centre's fail hotspots (from `junction_stats`) and the learner's past weak junctions. Code validates the route is drivable and meets coverage rules before use.

### 4.5 AI examiner (voice)
Modelled on the real UK test structure: a "tell me" question before setting off, a "show me" question while driving, directions, ~20 minutes of independent driving (examiners can extend it), and an emergency stop on roughly 1 in 7 tests. Learners can ask the examiner to repeat or clarify.

**Principle:** the AI is the person in the passenger seat — it talks, listens and explains. **It never decides faults.** It only voices faults the fault engine has logged.

- **[P0]** FR-E1. Spoken directions and neutral reactions using pre-generated audio (Gemini TTS) for all fixed phrases; browser Web Speech API fallback. Driving never waits on the network.
- **[P0]** FR-E2. End-of-test spoken result ("I'm pleased to say you've passed" / "Unfortunately you haven't passed today").
- **[P1]** FR-E3. **Two-way conversation** via the Gemini Live API (browser mic, streaming audio):
  - Greeting and short explanation of the test.
  - Learner can ask "Which exit?", "Can you repeat that?" and get a natural answer using the current route state (passed to the model as context/tool results).
  - Calm, neutral examiner persona; no small-talk distractions near manoeuvres.
- **[P1]** FR-E4. **"Tell me" question** before setting off: examiner asks one question from the official list; learner answers out loud; the model compares the answer to the official DVSA answer and returns `correct | incorrect` with a reason. Getting both show-me and tell-me wrong = 1 driving fault (as in the real test).
- **[P1]** FR-E5. **"Show me" question** while driving: "When it's safe, can you show me how you'd wash and clean the front windscreen?" The **code** checks the right control was used within 30 s without a steering deviation or speed loss beyond a threshold; loss of control = serious fault.
- **[P1]** FR-E6. **Spoken debrief Q&A:** after the result, learner can ask "Why was that a fault?" and the examiner answers from the RAG debrief (same citations).
- **[P2]** FR-E7. Independent driving: "Follow the signs for X until I tell you otherwise" or sat-nav mode, ~5 min in demo.
- **[P2]** FR-E8. Emergency stop: examiner raises hand/says "Stop!"; code measures reaction time and stopping control.
- **[P2]** FR-E9. Pull up on the left / reversing manoeuvre (bay park or pull up on the right).
- Function calling: the Live session is given tools such as `get_next_instruction()`, `get_route_status()`, `get_logged_faults()`, `submit_tell_me_answer(verdict)`, so the model answers from real state instead of guessing.

### 4.6 Fault engine (deterministic, client-side)
- **[P0]** FR-F1. Categories: `driving`, `serious`, `dangerous`.
- **[P0]** FR-F2. **FAIL** if driving faults > 15, or any serious or dangerous fault.
- FR-F3. Rules:

| ID | Rule | Detection | Category | Priority |
|---|---|---|---|---|
| R1 | Speeding | > limit + 2 mph for > 2 s | driving; serious if > limit + 10 | P0 |
| R2 | Red light | crosses stop line on red | dangerous | P0 |
| R3 | Mirror before signal | indicator on with no `M` in previous 3 s | driving | P0 |
| R4 | Mirror before turn/lane change | heading change > 30° or lane change with no `M` in previous 5 s | driving | P0 |
| R5 | No signal before turn | turn at junction without correct indicator in previous 3 s | driving | P0 |
| R6 | Wrong signal | indicator ≠ turn direction | driving | P0 |
| R9 | Roundabout lane | wrong approach lane for exit taken | driving | P0 |
| R11 | Collision | any contact | dangerous | P0 |
| R7 | Junction observation | no `Q` and `E` within 4 s before give-way/stop line | driving; serious if a vehicle had priority within 30 m | P1 |
| R8 | Failure to give way | enters conflict zone with priority vehicle present | serious | P1 |
| R10 | Pedestrian crossing | fails to stop for pedestrian | dangerous | P1 |
| R13 | Kerb | wheel crosses kerb | driving; serious if > 10 mph | P1 |
| R14 | Show me | wrong control / loss of control | driving / serious | P1 |
| R15 | Emergency stop | reaction > 1.5 s or loss of control | driving / serious | P2 |

- **[P0]** FR-F4. Each fault emits a `FaultEvent` (§7).
- **[P0]** FR-F5. Same inputs → same faults (unit-tested with recorded input traces).
- **[P1]** FR-F6. "Realistic mode": no on-screen fault flashes; faults revealed only at the end.

### 4.7 Debrief
- **[P0]** FR-D1. Result, fault counts by category, faults in time order, mini-map with pins. Rendered immediately from local data.
- **[P0]** FR-D2. Per-fault explanation + how to fix it, generated by `gemini-4-argon` using RAG over DVSA guidance (Automated Embedding + `$vectorSearch`).
- **[P0]** FR-D3. **Verification loop:** each explanation must cite a real `FaultEvent` ID and real `guidance_chunks` IDs. A validator checks the IDs exist and the cited chunk's `ruleIds` include the fault's rule; failures are regenerated once, then dropped. Citations shown in UI.
- **[P1]** FR-D4. "X% of learners fail here" per junction from `junction_stats`.
- **[P0]** FR-D5. Explanations stream in; first one within 10 s.

### 4.8 Instructor dashboard
- **[P0]** FR-I1. 2D map with fault heatmap per junction, filter by rule and category.
- **[P0]** FR-I2. New faults appear within ~10 s (reads `junction_stats` written by Stream Processing).
- **[P1]** FR-I3. Plain-English search ("roundabouts where learners miss mirror checks") via hybrid search + `$rerank`.
- **[P1]** FR-I4. Learner list with recent sessions and pass/fail trend.
- **[P1]** FR-I5. Saint action log with approval status.

### 4.9 Saint
Conditional on having a Saint seat (set up Saturday morning). Loose coupling: our app produces reports; Saint acts on them in email/calendar/docs.
- **[P1]** FR-S1. Backend generates a learner report (HTML) at `/api/reports/:sessionId`.
- **[P1]** FR-S2. Saint task: "When a new Dry Run report arrives, email it to the learner, then propose a 1-hour lesson in the instructor's calendar focused on the learner's top 2 weak junctions. Ask the instructor before confirming."
- **[P1]** FR-S3. Trigger: backend emails the report to Saint's inbox (simplest), or whatever Saint supports best.
- **[P1]** FR-S4. Saint asks before any first email to a learner and before any calendar event.
- **[P0]** FR-S5. Saint never books, changes or cancels a DVSA test.
- **[P1]** FR-S6. Saint actions logged to `saint_actions`.

### 4.10 Demo mode
- **[P0]** Fixed route, fixed seed, fixed hazards, one-key reset (`R`), seeded synthetic history so the heatmap looks populated (clearly labelled "simulated data").

---

## 5. Non-functional requirements
- **[P0]** ≥30 fps on a 2020+ laptop (integrated GPU) in Chrome; client memory < ~500 MB.
- **[P0]** No network call ever blocks driving; all AI calls async with fallbacks.
- **[P0]** Secrets only in `.env`; Gemini Live from the browser uses **ephemeral tokens** minted by the backend, never the raw API key.
- **[P0]** No real-world location tracking; learners identified by display name.
- **[P1]** Mic access requested only when the conversational examiner is enabled; push-to-talk option.

---

## 6. Tech stack (chosen tools)

| Area | Tool | Why |
|---|---|---|
| Client build | **Vite + TypeScript** | Fast dev server, simple |
| 3D rendering | **Three.js** (WebGLRenderer; WebGPURenderer optional P2) | Most mature browser 3D, huge example base; WebGL is the safe default for judging laptops |
| Vehicle physics | **Rapier** (`@dimforge/rapier3d-compat`) `DynamicRayCastVehicleController` | Purpose-built arcade-friendly raycast vehicle (port of Bullet's), JS API, also gives collisions with static colliders. Fallback: hand-written kinematic bicycle model |
| OSM download | **Overpass API** (export via overpass-turbo) for the bbox | No setup; one-off export |
| Lane/junction geometry | **osm2streets** (Rust, WASM/JS API, outputs GeoJSON lane + intersection polygons and lane markings) | Solves the hardest part (lane widths, junction shapes) from OSM tags; run offline in `/tools/osm-import`. Fallback: buffer road centrelines by lane count ourselves |
| Geo maths | **@turf/turf** + local metric projection around the centre | Polygons, distances, point-in-polygon for lanes/kerbs |
| Road graph / routing | **graphology** + **graphology-shortest-path** (or ngraph.path) | A* on the junction graph |
| Dashboard map | **MapLibre GL JS** with a free vector style (e.g. OpenFreeMap) + heatmap layer | Free, no key needed, built-in heatmap |
| Backend | **Node.js + Fastify + TypeScript** | One language across stack; fast |
| Database driver | Official **`mongodb`** Node driver | Needed for `$vectorSearch`, `$search`, `$rankFusion`, `$rerank` |
| AI SDK | **`@google/genai`** (latest) — Interactions API for Argon; Live API (`ai.live.connect`) for voice | Required by the Gemini bounty; ephemeral tokens for browser Live connections |
| Fallback voice | Browser **Web Speech API** (`speechSynthesis`) | Zero-latency, offline |
| Report email to Saint | **Nodemailer** (SMTP) or a transactional email API | Simplest Saint trigger |
| Testing | **Vitest** for fault-engine rules with recorded input traces | Determinism is a requirement |
| Coding agent | Claude Code, plus Gemini API skills (`gemini-api-dev`, `gemini-live-api-dev`) for current API usage | Avoids outdated Gemini code |

Verify at kickoff: exact Live model name available on our credits (the event lists `gemini-3.8-live`; current docs examples use `gemini-3.1-flash-live-preview`), and that our Atlas cluster version supports `$rankFusion` (8.0+) and `$rerank` (public preview, 8.3).

---

## 7. Data model (MongoDB Atlas, database `dryrun`)

**`centres`** `{ _id, name, location: GeoJSON Point, radiusM, assetsVersion }`

**`junctions`** `{ _id: "osm-node-…", centreId, type: roundabout|signals|giveway|stop|crossing|mini_roundabout, name, location: Point, summary }` — `2dsphere` on `location`; Search + autoEmbed on `summary`.

**`learners`** `{ _id, displayName, email?, instructorId?, createdAt }`

**`sessions`** `{ _id, learnerId, centreId, routeId, startedAt, endedAt, result: PASS|FAIL, counts: {driving, serious, dangerous}, tellMe: {questionId, verdict}, showMe: {questionId, verdict}, debrief: [{faultId, text, guidanceChunkIds}], summary }` — autoEmbed on `summary`.

**`fault_events`** (append-only, stream source) `{ _id, sessionId, learnerId, centreId, junctionId, ruleId, category, ts, location: Point, speedMph, context: {…} }` — `2dsphere` on `location`; `{centreId, junctionId, ruleId}`; `{sessionId, ts}`.

**`junction_stats`** (written by Stream Processing) `{ _id: {centreId, junctionId, ruleId}, faults, sessionsThrough, failRate, lastUpdated }`

**`guidance_chunks`** (RAG corpus) `{ _id, source, url, title, text, ruleIds: [] }` — autoEmbed + Atlas Search on `text`/`title`.

**`tell_me_questions`** `{ _id, question, officialAnswer, url }` (from official DVSA list)

**`saint_actions`** `{ _id, sessionId, action, status: pending_approval|approved|rejected|done, approvedBy, ts, details }`

---

## 8. MongoDB Atlas features (each must be visible in the demo video)

| Feature | Priority | Use |
|---|---|---|
| Atlas core | P0 | All app data |
| **Atlas Stream Processing** | P0 | `$source` = change stream on `fault_events` → `$tumblingWindow` (e.g. 10 s) grouping by `{centreId, junctionId, ruleId}` → `$merge` into `junction_stats`. Fallback if ASP setup blocks us: scheduled aggregation `$merge` (but try hard — it's a scored feature) |
| **Automated Embedding** | P0 | Vector index of type `autoEmbed` (Voyage model) on `guidance_chunks.text`; P1 on `sessions.summary`, `junctions.summary` |
| **Vector Search** | P0 | `$vectorSearch` for debrief RAG, filtered by `ruleIds` |
| **Atlas Search** | P1 | Exact terms ("Rule 186", "mini-roundabout") |
| **Hybrid Search** | P1 | `$rankFusion` of `$vectorSearch` + `$search` for instructor search and RAG |
| **Voyage rerank** | P1 | `$rerank` (rerank-2.5) after hybrid search |
| Geospatial | P0 | `$geoNear`/`$geoWithin` for heatmap and junction lookup |

---

## 9. AI models

| Model | Priority | Use |
|---|---|---|
| `gemini-4-argon` (Interactions API, `thinking_level` "medium"; no temperature/top_p/top_k; no explicit cached_content) | P0 | Debrief generation with verification loop; P2 adaptive route selection |
| Gemini TTS (`gemini-3.8-flash-tts`) | P0 | Pre-generate all fixed examiner phrases |
| Gemini Live (`gemini-3.8-live` or as provided) | P1 | Two-way conversational examiner, tell-me answer judging, debrief Q&A, with function calling |
| `gemini-3.8-flash` | P1 | Cheap tasks: session/junction summaries for search |

---

## 10. Architecture

```
Browser (Vite + Three.js + Rapier)
 ├─ World (static assets from /assets/<centre>)
 ├─ Car + traffic
 ├─ Fault engine ──────────────► POST /api/events (batched 1 s)
 ├─ Examiner: cached TTS audio / Web Speech fallback
 ├─ [P1] Gemini Live session (ephemeral token from GET /api/live-token)
 │     tools: get_next_instruction, get_route_status, get_logged_faults, submit_tell_me_answer
 └─ Debrief UI ◄── GET /api/sessions/:id/debrief (streamed)

Backend (Node + Fastify)
 ├─ sessions, events, debrief, search, reports, live-token, saint log
 ├─ RAG: $vectorSearch (autoEmbed) [→ $rankFusion + $rerank P1] → gemini-4-argon → citation validator
 └─ Report HTML → email to Saint inbox [P1]

MongoDB Atlas
 ├─ Collections (§7) · Search + Vector (autoEmbed) indexes
 └─ Stream Processing: fault_events (change stream) → junction_stats

Instructor dashboard (/instructor): MapLibre heatmap + search + Saint log

Offline tools
 ├─ /tools/osm-import: Overpass export → osm2streets → road graph JSON + GLB meshes
 ├─ /tools/ingest-guidance: DVSA guide + Highway Code pages → guidance_chunks (+ tell_me_questions)
 └─ /tools/seed-demo: synthetic sessions/faults for the heatmap
```

**Repo layout:** `/client` · `/server` · `/tools` · `/assets` · `/docs` · `.env.example`

**Env vars:** `MONGODB_URI`, `GEMINI_API_KEY`, `SAINT_INBOX_EMAIL`, `SMTP_URL`, `REPORT_BASE_URL`, `DEMO_MODE`, `CENTRE_ID`

---

## 11. API

| Method | Path | Priority | Purpose |
|---|---|---|---|
| POST | `/api/sessions` | P0 | Start session → `{sessionId, route}` |
| POST | `/api/events` | P0 | Batch of FaultEvents |
| POST | `/api/sessions/:id/end` | P0 | End, compute result, kick off debrief |
| GET | `/api/sessions/:id/debrief` | P0 | Streamed debrief with citations |
| GET | `/api/junctions/stats` | P0 | Heatmap data |
| GET | `/api/live-token` | P1 | Ephemeral token for Gemini Live |
| GET | `/api/search?q=` | P1 | Hybrid search + rerank |
| GET | `/api/reports/:sessionId` | P1 | Learner report |
| GET/POST | `/api/saint/actions` | P1 | Saint action log |

---

## 12. Data sources and licensing
- **OpenStreetMap** via Overpass — ODbL, attribution in UI and README.
- **DVSA Guide to the driving test, show me / tell me questions, Highway Code** (gov.uk) — Open Government Licence v3 (verify per page). Store URLs; show citations.
- Community test-route lists — inspiration only; don't scrape or republish.
- Synthetic seed data — labelled "simulated" in UI.

---

## 13. Build plan

| Milestone | When | Scope |
|---|---|---|
| M0 | Fri night | Repo, Atlas cluster + Stream Processing workspace, keys, Overpass export, osm2streets run, car driving on a flat map |
| M1 | Sat 12:00 | Road meshes + graph (or hand-modelled fallback), demo route, directions (Web Speech), R1–R6, events into Atlas |
| M2 | Sat 22:00 | **P0 complete end to end:** R9 + R11, cached Gemini TTS, ASP → `junction_stats` → heatmap, guidance ingested with autoEmbed, debrief RAG + verification + citations, demo mode |
| M3 | Sun 11:00 | P1: Gemini Live examiner (greeting, tell me, show me, Q&A), traffic + hazards, R7/R8/R10, hybrid search + rerank, Saint flow |
| M4 | Sun afternoon | Feature freeze, README, videos, submission notes, rehearse live demo twice |

**Suggested owners (4 people):** (1) world + osm-import · (2) car, traffic, hazards · (3) examiner (TTS → Live) + fault engine · (4) backend, MongoDB, RAG, dashboard, Saint, videos.

---

## 14. Demo (3 min) and submission

**Live demo script**
1. 15 s — problem: ~48.7% pass rate, ~22-week waits, routes unpublished since 2010.
2. 20 s — examiner greets the learner and asks a "tell me" question; learner answers by voice; examiner accepts it. **[P1]**
3. 75 s — drive the route: spoken directions; learner asks "which exit?" **[P1]**; deliberate wrong lane at roundabout (R9) and signal without mirror (R3) flagged; "show me" question mid-drive **[P1]**.
4. 30 s — debrief: result, pins on map, explanations streaming in with DVSA citations, "X% fail here".
5. 25 s — instructor dashboard: heatmap updates live (Stream Processing); search query **[P1]**; Saint emails report + proposes lesson awaiting approval **[P1]**.
6. 15 s — who pays + what's next.

**P0-only fallback script:** skip the [P1] steps; everything else still works.

**Submission checklist**
- [ ] GitHub repo, README with setup instructions, OSM attribution, data sources
- [ ] MongoDB: 3-min video showing the app and MongoDB features in use
- [ ] Saint: 2–4 min demo of Saint doing the job end to end + note on what it was asked, tools, devices and accounts used
- [ ] Gemini: 3-min video + live demo; note of models/agents used and how (Argon debrief + verification loop, Live examiner, TTS)
- [ ] Real World (if entering): 2–4 min video on real inputs + note on models and data sources

---

## 15. Open questions
- Which test centre? (London; roundabout, signals, crossings and a tricky give-way within ~2 km)
- Do we have a Saint seat? If not, Saint items move out of scope and we lean harder on Gemini + Real World.
- Team size and owners.
- Exact submission deadline and demo slot.
