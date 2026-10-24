# Dry Run — Requirements Specification

Version 0.3 · 23 Oct 2026 · Encode London hackathon build · **solo build**
(Previous 4-person version kept at `docs/SPEC-v0.2-team.md`.)

> **Rule:** all code is written during the hackathon. Libraries and starter templates are fine.
> **Priority tags:** **[P0]** = MVP, must work to submit · **[P1]** = should have, build once P0 is solid · **[P2]** = stretch, only if ahead of schedule.
> **Deadlines:** build freeze **Sat 21:00** · submission **Sun 12:00**.
> **Cut rules:**
> - **Sat 12:00:** if OSM lane geometry isn't drivable, switch to hand-modelled junctions (§4.1) and move on.
> - **Sat 18:00:** if P0 isn't working end to end, stop all P1 work and fix P0.
> - **Sat 21:00:** feature freeze. After this, only bug fixes, README and videos.

---

## 1. Overview

**Dry Run** is a browser-based 3D simulator of the real roads around a UK driving test centre. A learner drives a test-style route while an **AI examiner** gives spoken directions and, at the end, debriefs them. A deterministic fault engine marks the drive using DVSA-style categories. Every fault streams into MongoDB Atlas, building a map of where learners fail at that centre, overlaid with **real collision data (STATS19)** for the same roads.

**Problem:** the national car test pass rate was ~48.7% in 2024-25, average waits were ~22 weeks in April 2026, and the DVSA stopped publishing test routes in 2010. Learners go into the test without having practised the junctions that catch people out at their centre. *(Verify each figure and keep the source URL for the README.)*

**Who it's for:** any learner driver. **Demo persona:** the builder (or any real learner), named in the pitch, at the centre we build — ideally their local centre. Gemini judges score "a specific person you can name".

**Who pays:** learners (per mock test / subscription) and driving schools (instructor dashboard).

---

## 2. Sponsor tracks

| Track | Role | What judges want | How Dry Run hits it |
|---|---|---|---|
| **MongoDB Atlas** | **Primary** | App relies on Atlas; more Atlas features = more points; 3-min video showing MongoDB in use | Atlas for all data + Stream Processing + Automated Embedding + Vector Search + geospatial (P0); Atlas Search + Hybrid Search + Voyage rerank (P1) (§8) |
| **Gemini 4 Argon** (Pathway 2) | **Secondary** | Live demo with real inputs (50%), named user, needs Argon, verification loop, human control | Argon debrief with a citation-checking verification loop; Gemini TTS examiner; Live voice examiner (P1) (§9) |
| **Saint** | Optional | Cool factor, Saint actually doing the job, human control | Saint gets each report, drafts the learner email and a lesson proposal, and asks the instructor before sending (§4.9). **Sign up at the Fri 18:00 check-in.** |
| The Real World (Encode) | Bonus (reuse video) | Real data, honest uncertainty, privacy | Real OSM roads + real DfT collision data; flags guessed geometry; no location tracking |

Submission notes per track: §14.

---

## 3. Goals and non-goals

### Goals
- **[P0]** Drive a car in the browser around one real test centre built from OpenStreetMap.
- **[P0]** Examiner gives spoken directions along a fixed demo route.
- **[P0]** Deterministic fault engine with DVSA categories; PASS/FAIL result.
- **[P0]** Faults stored in Atlas; per-junction stats via Stream Processing; heatmap with STATS19 collisions.
- **[P0]** Debrief explaining each fault, grounded in DVSA guidance via RAG, with checked citations.
- **[P1]** Instructor search (hybrid + rerank), Saint workflow, Gemini Live "tell me" question.
- **[P2]** Two-way conversational examiner, AI traffic, scripted hazards, adaptive routes.

### Non-goals
- Manual gears, mobile, multiple centres (the data model allows them; build one), user accounts beyond a display name.
- **Booking or changing DVSA tests.** Nothing in the system does this. *(Verify the claim that booking for someone else has been illegal since May 2026 before saying it in the pitch.)*

---

## 4. Functional requirements

### 4.1 World
- **[P0]** FR-W1. Load pre-processed map assets for one centre (centre lat/lng + ~1 km radius; keep it small).
- **[P0]** FR-W2. Roads as 3D meshes with plausible widths, centre lines and give-way/stop lines on the demo route.
- **[P0]** FR-W3. One roundabout and one set of traffic signals (working light cycle) on the demo route.
- **[P0]** FR-W4. Buildings as extruded footprints (flat colours, merged meshes).
- **[P0]** FR-W5. Speed limits from OSM `maxspeed`; 30 mph when missing.
- **[P0]** FR-W6. Road graph (junction nodes, directed edges) used by routing and fault detection.
- **[P0]** FR-W7. Stable junction IDs from OSM node IDs, so faults aggregate across sessions.
- **[P0]** FR-W8. Offline pre-processing script (`/tools/osm-import`); the browser never loads raw OSM.
- **[P0]** FR-W9. "© OpenStreetMap contributors" attribution visible.
- **[P1]** FR-W10. Junctions where geometry was guessed (missing lane tags) are flagged `geometryConfidence: low` and shown on the dashboard (honest uncertainty).
- **Approach:** try osm2streets first (time-box: Fri night). If it fights back, buffer OSM centrelines by `lanes × 3.2 m` with turf. **Fallback at Sat 12:00:** hand-model the 4–5 demo junctions; keep OSM for buildings/background.
- **Decision (Fri, `osm-import`):** skipped osm2streets (Rust tool, too risky to run on Windows in the time). Roads are built in the browser from centrelines instead: a strip of `lanes × 3.2 m` per road (service roads at least 4 m) plus a round patch where roads meet or end. No turf needed. Two upgrades on top: **pavements** (a 2 m paler strip either side, none on service roads or motorways) and **lane lines** (solid edge lines, dashed lane dividers, a longer-dash centre line on two-way roads, all stopping short of junctions). Trade-off: junctions are rounded blobs, not proper kerbed corners, and bridges (`layer`) are drawn flat. osm2streets can still be tried later without changing `world.json`.
- **Output:** one file, `assets/wanstead/world.json` (types in `client/src/world/types.ts`): roads, buildings, junctions (typed from nearby signals/give-way/stop/crossing nodes, `geometryConfidence`), controls, and the directed road graph. The browser builds the meshes when it loads.

### 4.2 Player vehicle
- **[P0]** FR-V1. Rapier raycast vehicle (`DynamicRayCastVehicleController`): accelerate, brake, steer, reverse. Speedometer in mph. Fallback: kinematic bicycle model.
- **[P0]** FR-V2. Keyboard: Arrows/WASD drive · `Z`/`X` left/right indicator · `M` mirror check · `Q`/`E` look left/right · `Space` handbrake · `Esc` pause · `R` reset.
- **[P0]** FR-V3. First-person camera; `C` toggles chase cam.
- **[P0]** FR-V4. Mirror check and look left/right visibly move the camera.
- **[P0]** FR-V5. Collisions with buildings and parked cars.
- **[P1]** FR-V6. "Show me" controls: `1` washers, `2` rear demister, `3` horn, `4` front demister, `5` headlights.

### 4.3 Traffic
- **[P0]** FR-T1. Traffic lights cycle; a few parked cars.
- **[P2]** FR-T2. A handful of AI cars on the route following the graph and obeying lights.
- **[P2]** FR-T3. Scripted hazards (pedestrian on crossing, car pulling out).

### 4.4 Route and directions
- **[P0]** FR-R1. One fixed demo route from the centre and back: ≥1 roundabout, ≥1 signalled junction, ≥1 give-way junction. ~3–4 min of driving.
- **[P0]** FR-R2. Directions generated from the route ("At the roundabout, take the third exit"), triggered by distance/speed so they're spoken ≥4 s before the manoeuvre.
- **[P1]** FR-R3. Off-route: say neutrally "That's fine, take the next left" and rejoin (simple: route back to the nearest route node).
- **[P2]** FR-R4. Adaptive route: `gemini-4-argon` picks a route weighted toward fail hotspots + collision hotspots; code validates it.

### 4.5 AI examiner (voice)
**Principle:** the AI talks, listens and explains. **It never decides faults.** It only voices faults the fault engine has logged.

- **[P0]** FR-E1. Directions and fixed phrases as audio pre-generated with Gemini TTS (`/tools/gen-tts`), with Web Speech API fallback. Driving never waits on the network.
- **[P0]** FR-E2. Spoken end-of-test result ("I'm pleased to say you've passed" / "Unfortunately you haven't passed today").
- **[P1]** FR-E3. **"Tell me" question via Gemini Live** before setting off: examiner asks one official question; learner answers by voice; model compares with the official answer and calls `submit_tell_me_answer({verdict, reason})`. Push-to-talk. Ephemeral token from backend.
- **[P2]** FR-E4. Learner can ask "Which exit?" / "Repeat that" during the drive (Live tools `get_next_instruction`, `get_route_status`).
- **[P2]** FR-E5. "Show me" question mid-drive, checked by code (R14).
- **[P2]** FR-E6. Spoken debrief Q&A ("Why was that a fault?") answered from the RAG debrief.

### 4.6 Fault engine (deterministic, client-side)
- **[P0]** FR-F1. Categories: `driving`, `serious`, `dangerous`.
- **[P0]** FR-F2. **FAIL** if driving faults > 15, or any serious or dangerous fault.
- FR-F3. Rules:

| ID | Rule | Detection | Category | Priority |
|---|---|---|---|---|
| R1 | Speeding | > limit + 2 mph for > 2 s | driving; serious if > limit + 10 | P0 |
| R2 | Red light | crosses stop line on red | dangerous | P0 |
| R3 | Mirror before signal | indicator on with no `M` in previous 3 s | driving | P0 |
| R4 | Mirror before turn | heading change > 30° at a junction with no `M` in previous 5 s | driving | P0 |
| R5 | No signal before turn | turn at junction without correct indicator in previous 3 s | driving | P0 |
| R6 | Wrong signal | indicator ≠ turn direction | driving | P0 |
| R9 | Roundabout lane | wrong approach lane for exit taken | driving | P0 |
| R11 | Collision | any contact | dangerous | P0 |
| R15 | Tell me question | wrong answer to the 'tell me' question (FR-E3), judged by Gemini Live against the official DVSA answer | driving | P1 |
| R7 | Junction observation | crossing a give-way line with no `Q` and `E` in the 4 s before (roundabouts: `E` only, traffic comes from the right). Not judged at traffic lights or junctions with no line | driving | P1 |
| R8 | Moving off safely | pulling away from the kerb (start of the drive) with no `M` and `E` (right shoulder) in the 5 s before. Not judged after stopping in traffic | driving | P1 |
| R13 | Kerb | wheel crosses kerb | driving; serious if > 10 mph | P2 |

- **[P0]** FR-F4. Each fault emits a `FaultEvent` (§7) with the nearest junction ID.
- **[P0]** FR-F5. Same inputs → same faults. Vitest tests for each P0 rule using recorded input traces.
- **[P1]** FR-F6. "Realistic mode": no on-screen fault flashes; faults revealed at the end.

### 4.7 Debrief
- **[P0]** FR-D1. Result, fault counts by category, faults in time order, mini-map with pins. Rendered immediately from local data.
- **[P0]** FR-D2. Per-fault explanation + how to fix it, generated by `gemini-4-argon` using RAG over DVSA guidance (Automated Embedding + `$vectorSearch`, filtered by `ruleIds`).
- **[P0]** FR-D3. **Verification loop:** each explanation must cite a real `FaultEvent` ID and real `guidance_chunks` IDs. Validator checks the IDs exist and the cited chunk's `ruleIds` include the fault's rule; failures are regenerated once, then dropped. Citations shown in UI.
- **[P0]** FR-D4. "X% of learners get a fault here" + "N reported collisions here since 2020" per junction.
- **[P0]** FR-D5. Explanations stream in; first one within 10 s.

### 4.8 Instructor dashboard (`/instructor`)
- **[P0]** FR-I1. MapLibre map: fault heatmap per junction (filter by rule/category) + STATS19 collision layer.
- **[P0]** FR-I2. New faults appear within ~10 s (reads `junction_stats` written by Stream Processing).
- **[P1]** FR-I3. Plain-English search ("roundabouts where learners miss mirror checks") via `$rankFusion` (vector + Atlas Search) + `$rerank`. **Dropped:** hybrid search + rerank feed the debrief's guidance instead (FR-D2).
- **[P1]** FR-I4. Saint action log with approval status.
- **[P2]** FR-I5. Learner list with pass/fail trend.

### 4.9 Saint (optional — only if we get a seat)
Loose coupling: the app produces reports; Saint acts on them in email/calendar. Little code on our side.
- **[P1]** FR-S1. `/api/reports/:sessionId` returns a learner report (HTML).
- **[P1]** FR-S2. Backend emails the report to Saint's inbox when a session ends.
- **[P1]** FR-S3. Saint task: "When a Dry Run report arrives, draft an email to the learner with it, and propose a 1-hour lesson in the instructor's calendar focused on the learner's top 2 weak junctions. Ask the instructor before sending or booking anything."
- **[P1]** FR-S4. Saint actions recorded in `saint_actions` (Saint calls `POST /api/saint/actions`, or we log on its emails).
- **[P0]** FR-S5. Saint never books, changes or cancels a DVSA test.

### 4.10 Demo mode
- **[P0]** Fixed route, one-key reset (`R`), seeded synthetic history so the heatmap looks populated (labelled "simulated data" in the UI; STATS19 layer is real and labelled as such).

---

## 5. Non-functional requirements
- **[P0]** ≥30 fps on a 2020+ laptop in Chrome.
- **[P0]** No network call ever blocks driving; all AI calls async with fallbacks.
- **[P0]** Secrets only in `.env`; the browser gets Gemini Live access only via backend-minted **ephemeral tokens**.
- **[P0]** No real-world location tracking; learners identified by display name.
- **[P1]** Mic requested only when the voice examiner is enabled; push-to-talk.

---

## 6. Tech stack

| Area | Tool |
|---|---|
| Client | Vite + TypeScript + **Three.js** (WebGLRenderer) |
| Vehicle physics | **Rapier** (`@dimforge/rapier3d-compat`) raycast vehicle |
| OSM | Overpass API export → osm2streets (or turf buffering) in `/tools/osm-import` |
| Geo maths | `@turf/turf` + local metric projection |
| Road graph | `graphology` |
| Dashboard map | MapLibre GL JS + OpenFreeMap style |
| Backend | Node.js + Fastify + TypeScript |
| Database | Official `mongodb` driver |
| AI | `@google/genai` (latest): Interactions API for Argon, Live API for voice, TTS |
| Email to Saint | Nodemailer |
| Tests | Vitest |

Verify at kickoff: exact Gemini model names available on our credits (event lists `gemini-3.8-live`, `gemini-3.8-flash-tts`); Atlas cluster supports `$rankFusion` (8.0+) and `$rerank`; Stream Processing workspace can be created on our tier.

---

## 7. Data model (MongoDB Atlas, database `dryrun`)

**`centres`** `{ _id, name, location: Point, radiusM }`

**`junctions`** `{ _id: "osm-node-…", centreId, type: roundabout|signals|giveway|stop|crossing, name, location: Point, geometryConfidence: high|low, collisions: {total, serious, fatal, since}, summary }` — `2dsphere` on `location`; Search + autoEmbed on `summary` (P1).

**`collisions`** (STATS19, real) `{ _id: accident_index, centreId, date, severity: slight|serious|fatal, location: Point, junctionDetail, junctionControl, nearestJunctionId }` — `2dsphere` on `location`.

**`learners`** `{ _id, displayName, email?, createdAt }`

**`sessions`** `{ _id, learnerId, centreId, routeId, startedAt, endedAt, result: PASS|FAIL, counts: {driving, serious, dangerous}, tellMe?: {questionId, verdict, reason}, debrief: [{faultId, text, guidanceChunkIds}], summary }`

**`fault_events`** (append-only, stream source) `{ _id, sessionId, learnerId, centreId, junctionId, ruleId, category, ts, location: Point, speedMph, context }` — indexes: `2dsphere` on `location`; `{centreId, junctionId, ruleId}`; `{sessionId, ts}`.

**`junction_stats`** (written by Stream Processing) `{ _id: {centreId, junctionId, ruleId}, faults, sessionsThrough, lastUpdated }`

**`guidance_chunks`** (RAG corpus) `{ _id, source, url, title, text, ruleIds: [] }` — autoEmbed vector index on `text` (P0); Atlas Search on `text`/`title` (P1).

**`tell_me_questions`** `{ _id, question, officialAnswer, url }`

**`saint_actions`** `{ _id, sessionId, action, status: pending_approval|approved|rejected|done, ts, details }`

---

## 8. MongoDB Atlas features (each must be visible in the MongoDB video)

| Feature | Priority | Use |
|---|---|---|
| Atlas core | P0 | All app data |
| **Atlas Stream Processing** | P0 | change stream on `fault_events` → `$tumblingWindow` (10 s) grouped by `{centreId, junctionId, ruleId}` → `$merge` into `junction_stats`. Fallback if ASP blocks for > 1 h: scheduled aggregation with `$merge` |
| **Automated Embedding** | P0 | autoEmbed vector index (Voyage) on `guidance_chunks.text` |
| **Vector Search** | P0 | `$vectorSearch` for debrief RAG, filtered by `ruleIds` |
| Geospatial | P0 | `$geoNear` for fault → junction and collision → junction; heatmap queries |
| **Atlas Search** | P1 | Exact terms ("Rule 186", "mini-roundabout") |
| **Hybrid Search** | P1 | `$rankFusion` of `$vectorSearch` + `$search` to find the debrief's guidance |
| **Voyage rerank** | P1 | `$rerank` after hybrid search |

---

## 9. AI models

| Model | Priority | Use |
|---|---|---|
| `gemini-4-argon` (Interactions API, `thinking_level: "medium"`; no temperature/top_p/top_k) | P0 | Debrief generation with citation verification loop |
| `gemini-3.8-flash-tts` | P0 | Pre-generate all fixed examiner phrases |
| `gemini-3.8-flash` | P1 | Junction/session summaries for search |
| Gemini Live (`gemini-3.8-live` or as provided) | P1 | "Tell me" question by voice, with function calling |

---

## 10. Data sources and licensing
- **OpenStreetMap** via Overpass — ODbL; attribution in UI and README.
- **DfT road safety data (STATS19)** — collisions with coordinates, severity, junction detail; Open Government Licence. Import only the centre's bbox, last ~5 years.
- **DVSA Guide to the driving test, show me / tell me questions, Highway Code** (gov.uk) — Open Government Licence v3 (verify per page). Store URLs; show citations.
- Synthetic seed sessions — labelled "simulated" in the UI.

---

## 11. Architecture

```
Browser (Vite + Three.js + Rapier)
 ├─ World (static assets from /assets/<centre>)
 ├─ Car + traffic lights + parked cars
 ├─ Fault engine ───────────────► POST /api/events (batched 1 s)
 ├─ Examiner: cached TTS audio / Web Speech fallback
 ├─ [P1] Gemini Live tell-me (ephemeral token from GET /api/live-token)
 └─ Debrief UI ◄── GET /api/sessions/:id/debrief (streamed)

Backend (Node + Fastify)
 ├─ sessions, events, debrief, stats, search, reports, live-token, saint log
 ├─ RAG: $rankFusion($vectorSearch autoEmbed + $search) → $rerank → gemini-4-argon → citation validator
 └─ [P1] Report HTML → email to Saint inbox

MongoDB Atlas
 ├─ Collections (§7) · Search + Vector (autoEmbed) indexes · 2dsphere
 └─ Stream Processing: fault_events → junction_stats

Instructor dashboard (/instructor): MapLibre faults heatmap + collisions layer + search + Saint log

Offline tools
 ├─ /tools/osm-import     Overpass export → road graph JSON + meshes
 ├─ /tools/import-stats19 DfT CSV → collisions (bbox filter) → nearest junction
 ├─ /tools/ingest-guidance DVSA + Highway Code pages → guidance_chunks + tell_me_questions
 ├─ /tools/gen-tts        Gemini TTS for all fixed phrases → /assets/audio
 └─ /tools/seed-demo      synthetic sessions/faults
```

**Repo layout:** `/client` · `/server` · `/tools` · `/assets` · `/docs` · `.env.example`

**Env vars:** `MONGODB_URI`, `GEMINI_API_KEY`, `SAINT_INBOX_EMAIL`, `SMTP_URL`, `REPORT_BASE_URL`, `DEMO_MODE`, `CENTRE_ID`

### API

| Method | Path | Priority | Purpose |
|---|---|---|---|
| POST | `/api/sessions` | P0 | Start session → `{sessionId, route}` |
| POST | `/api/events` | P0 | Batch of FaultEvents |
| POST | `/api/sessions/:id/end` | P0 | End, compute result, start debrief |
| GET | `/api/sessions/:id/debrief` | P0 | Streamed debrief with citations |
| GET | `/api/junctions/stats` | P0 | Heatmap + collision data |
| GET | `/api/live-token` | P1 | Ephemeral token for Gemini Live |
| GET | `/api/search?q=` | P1 | Hybrid search + rerank |
| GET | `/api/reports/:sessionId` | P1 | Learner report HTML |
| GET/POST | `/api/saint/actions` | P1 | Saint action log |

---

## 12. Build plan (solo)

Times are targets. Each block ends with something that runs. Commit at the end of every block.

### Friday 23 Oct — setup + car (19:30 → ~01:30)
| Time | Task | Done when |
|---|---|---|
| 18:00 | Saint check-in: sign up (before starting the build) | Seat requested |
| 19:30–20:30 | Repo + Vite/TS client + Fastify server; Atlas cluster, DB user, IP allowlist; create Stream Processing workspace; Gemini key; `.env` | `npm run dev` serves both; server pings Atlas |
| 20:30–20:50 | Confirm Wanstead centre coordinates; Overpass export of ~1 km bbox; download STATS19 CSVs; sketch demo route | Files in `/tools/data` |
| 20:50–22:30 | Three.js scene + Rapier raycast car on a flat plane; cameras; keyboard incl. indicators/mirror/look | Can drive around with speedo in mph |
| 22:30–01:30 | `/tools/osm-import`: osm2streets **or** turf-buffered roads + extruded buildings + road graph JSON | Roads/buildings render in the browser at the right scale |

### Saturday 24 Oct — everything else (08:00 → 21:00 freeze)
| Time | Task | Done when |
|---|---|---|
| 08:00–10:00 | Car on real roads; road colliders; traffic light cycle; parked cars; demo route defined | Can drive the full route |
| 10:00–12:00 | Directions from route (Web Speech first); fault engine R1–R6 + tests | Faults appear in console along the route |
| **12:00** | **Checkpoint:** geometry usable? If not → hand-model demo junctions | — |
| 12:00–13:30 | R9 roundabout lane + R11 collision; `POST /api/events`; sessions start/end; result screen | Faults land in Atlas |
| 13:30–15:00 | Stream Processing → `junction_stats`; `import-stats19`; `/instructor` MapLibre heatmap + collisions | Drive → heatmap updates within ~10 s |
| 15:00–17:00 | `ingest-guidance` + autoEmbed index; debrief endpoint: `$vectorSearch` → Argon → validator → stream; debrief UI with citations | Debrief with checked citations streams in |
| 17:00–18:00 | `gen-tts` cached audio; spoken result; `seed-demo`; demo mode + reset | **P0 end to end** |
| **18:00** | **Checkpoint:** P0 working? If not → fix P0 only until 21:00 | — |
| 18:00–19:30 | P1 MongoDB: Atlas Search index + `$rankFusion` + `$rerank` instructor search | Search query returns sensible junctions |
| 19:30–21:00 | P1 pick by status: Saint report + email (if seat) **or** Gemini Live tell-me question | Works once, end to end |
| **21:00** | **Feature freeze** | — |
| 21:00–23:00 | Bug fixes only; full rehearsal drive ×3 | Demo route runs clean 3 times in a row |

### Sunday 25 Oct — ship (→ 12:00)
| Time | Task |
|---|---|
| 08:00–09:00 | README: setup, data sources + licences, OSM attribution, models used |
| 09:00–10:30 | Record videos: MongoDB (3 min), Gemini (3 min), Saint (2–4 min, if used) |
| 10:30–11:15 | Submission notes per track (§14); push repo |
| 11:15–11:30 | **Submit** (30-min buffer before 12:00) |
| After | Rehearse the 3-min live Gemini demo |

---

## 13. Demo script (3 min)

1. **15 s — problem + persona:** "This is [name]. Their test at [centre] is in [n] weeks. Pass rate ~48.7%, ~22-week waits, routes unpublished since 2010."
2. **(P1) 20 s —** examiner asks a "tell me" question; learner answers by voice; examiner accepts it.
3. **75 s — drive:** spoken directions; deliberate wrong signal at the roundabout (R6) and signal without mirror (R3). The real approach has one lane (OSM `lanes=1`, matches the satellite view), so R9 cannot fire on this route.
4. **30 s — debrief:** result, pins on map, explanations streaming in with DVSA citations, "X% of learners get a fault here · N collisions here since 2020".
5. **45 s — instructor dashboard:** heatmap updates live (Stream Processing); real collision layer; plain-English search (P1); Saint drafts report + lesson awaiting approval (P1).
6. **15 s —** who pays + what's next (more centres, adaptive routes).

**P0-only fallback:** skip step 2 and the P1 parts of step 5.

**MongoDB video:** same flow, but show Atlas UI: the stream processor running, `junction_stats` changing, the vector index, and the aggregation pipelines.

---

## 14. Submission checklist
- [ ] GitHub repo, README with setup, OSM attribution, data sources and licences
- [ ] **MongoDB:** 3-min video showing the app and each Atlas feature in use
- [ ] **Gemini:** 3-min video + live demo; note: Argon debrief + verification loop, Gemini TTS examiner, Live tell-me (if built)
- [ ] **Saint (if seat):** 2–4 min demo of Saint doing the job end to end + note on what it was asked, tools and accounts used
- [ ] **Real World (bonus):** reuse video; note on models and data sources (OSM, STATS19, DVSA guidance)

---

## 15. Open questions
- **Centre: Wanstead (London)** — Hermon Hill, E11 2AW (most sources; confirm on gov.uk). ~10 km from the venue (Encode Hub, 41 Pitfield St, N1 6DA). Among the lowest pass rates in London (~40–44%, sources differ — use official DVSA figure). Known tricky spots nearby: Charlie Brown's roundabout (spiral, A406) and traffic joining from the A406. **Open:** these big grade-separated junctions may be too complex for OSM import; the demo route may use smaller local junctions, with the big ones hand-modelled only if time allows. Confirm after the Overpass export Fri night.
- Saint seat? Decided at Fri 18:00 check-in.
- Gemini live demo slot time.
- Verify problem stats and the May 2026 booking-law claim, with sources.

---

## 16. v2 — "Learn your test area"

Decided 24 Oct 2026, after the checkpoint 2 submission. The checkpoint build is tagged `checkpoint-2`; v2 work happens on the `v2` branch and is merged into `main` (which Railway deploys) only when a step works end to end.

### 16.1 What we're building

Not a route memoriser and not only an examiner. Test routes haven't been published since 2010, examiners vary them, and about half the test is independent driving, so memorising one loop teaches the wrong thing. What's worth learning is **the area**: its 5–10 tricky junctions, roundabout lanes and hidden give-ways. That local knowledge is the moat.

**One product, "learn your test area", with two modes that share the same fault engine:**
- **Practice (instructor voice):** the default. It coaches in the moment ("check your right mirror", "right lane for the third exit here"). It's fine to leave the route; you can repeat a junction or free-drive around the area.
- **Mock test (examiner voice):** a random route, a silent examiner, independent driving, real marking, pass or fail at the end.
- **Progress, joining the two:** "your weak junctions", built from your past drives in Atlas. That's how practice turns into passing.

The fault engine, world and directions already exist. Practice mode mostly changes **when and how** a fault is voiced (straight away, with coaching) instead of saving it for the end. It follows the real learner journey: lessons → mock test → real test.

### 16.2 What's wrong with the checkpoint build (why v2)

**It isn't the real test yet**

| Real test | Checkpoint build |
|---|---|
| ~40 min, ~20 of them independent driving (satnav or signs, no examiner directions) | ~4 min, every turn spoken |
| One manoeuvre: parallel park, bay park, or pull up on the right and reverse | Only "pull up on the left" |
| Emergency stop on ~1 in 3 tests | None |
| A "show me" question while driving | Only the "tell me" question before setting off |
| You don't know your route | One loop, the same every time |

**It marks the wrong things.** Only 8 rules exist (R1–R6, R9, R11). Junction observation (R7), which as recalled (verify against DVSA's published list) is the top reason people fail, was never built. Also not checked: moving off safely (mirrors and blind spot before pulling away), road position and lane discipline away from roundabouts, response to signs and road markings (stop lines, no entry), following distance. It can say "pass" where an examiner would fail you at the first junction, and that false confidence is worse than silence.

**The roads are empty.** No other cars, cyclists or pedestrians, so the "response to other road users" part of the marking sheet can't happen, and a roundabout with no traffic teaches the wrong habit (rolling straight on).

**It doesn't help you get better.**
- No practice mode: faults come only at the end.
- No progress: each learner gets a random ID in the browser and every drive is in Atlas, but the learner never sees their history. Today that data only feeds the instructor heatmap, which isn't wanted.
- No local advice: the debrief quotes the general Highway Code, not "at this roundabout, take the right lane for the third exit".
- No junction preview before driving, and no replay of the moment a fault happened.

**Things that break trust**
- **Bug:** ending the test without driving counts as a pass (Enter at 0 mph gave "PASS · No faults. Well driven.").
- The ">15 driving faults = fail" mark is from the 40-minute test, so on a 4-minute route it's almost never reached.
- More than 15 m off the route and the examiner just stops talking (FR-R3, "that's fine, take the next left", was never built).
- Junctions are rounded patches without lane arrows, yet R9 marks lane choice, which can feel unfair. Not yet confirmed that speed limit signs are visible, though speeding is marked.
- On/off keyboard controls and an automatic car; most UK tests are manual. Controller/wheel support would help skills carry over.
- Only Wanstead, although the pitch is "your test centre".

### 16.3 How other sites build worlds fast, and what we take from it

Trailhead (trailhead.drk1rd.com, "any real place on Earth") never builds a place by hand. Its server hands out tiles of free worldwide data on demand (OpenStreetMap; Overture building outlines, incl. Microsoft/Google AI-traced ones; AWS terrain; ESA WorldCover land cover; Meta tree heights; Sentinel-2 satellite colour; Open-Meteo weather) and the browser builds the world in a background worker with simple rules as you drive. It's an off-road game, so roads only need to be drivable, not correct: no lanes that matter, no lights, no junction meaning, no test logic.

Our world pipeline already works for any place (change `CENTRE` in `client/src/config.ts`, then `osm-fetch`, `osm-import`, `scenery`). Our effort went into the test layer (junction types, lights, directions, fault engine, crash data, debrief), which is a one-off. The only per-centre hand work left is **picking a route and checking it**.

Take from it:
- **Centres on request:** the server runs our pipeline the first time someone picks a centre and keeps the result. With automatic routes, a learner types their centre and drives it a minute later.
- **Better free data:** Overture building outlines to fill OSM gaps; Meta tree heights to put trees where they really are.

Don't take: satellite ground colour. Sentinel-2 pixels are 10 m wide, so it's blurry at street level (the same reason Google 3D Tiles were dropped).

### 16.4 Build order

One session each (names in CLAUDE.md). Before each one, say plainly what the learner will see.

1. **Early-finish bug:** ending before the route is done is "test not finished", not a pass.
2. **Junction observation (R7) and moving off safely:** mark what actually fails people.
3. **Automatic routes:** build loops from the centre's road graph that include a roundabout, lights and a give-way. Gives 3+ routes per centre with no hand work.
4. **Route choice and mock test:** pick a route or "surprise me"; a silent examiner; a stretch of independent driving following signs; a fault limit that fits the length of the drive.
5. **Off-route recovery:** "that's fine, take the next left", then reroute back to the route.
6. **Practice mode (instructor voice):** coaching in the moment, repeat a junction, free drive.
7. **Your weak junctions:** a learner history from Atlas; the practice start screen suggests what to work on.
8. **Local junction tips:** advice for each tricky junction, used in practice coaching and the debrief.
9. **Manoeuvres and emergency stop.**
10. **Other road users:** a few cars at the roundabout and lights, someone at the zebra.
11. **Any centre:** type a test centre or postcode; the server builds the area and routes, then caches them.
