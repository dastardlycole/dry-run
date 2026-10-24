# Dry Run

Solo hackathon build: a browser driving sim of the roads around Wanstead test centre (London), with an AI examiner and MongoDB Atlas. Full requirements in [SPEC.md](SPEC.md); build plan with times in SPEC §12. Build freeze **Sat 21:00**, submit **Sun 11:30** (deadline 12:00).

## How we work (remind me if I skip a step)

- One feature per session. Start with `/clear`, then `/rename <feature>`.
- Plan first for anything bigger than a small fix (Shift+Tab for plan mode). I approve the plan before code is written.
- Give every feature a check: tests, a build, or a screenshot compared to the screen file.
- Before calling it done, run `/code-review` for a fresh look, then commit.
- If Claude gets the same thing wrong twice, `/clear` and start again with a clearer request.
- At the start of a session, if I jump straight into a feature, remind me of this list in one line.
- At the end of a session (feature committed), ask me if I'm ready for the next session's instructions. When I say yes, give them: the branch to be on, `/clear`, `/rename <name>` for the next feature in the table, and a ready-to-paste opening prompt for that session (what to build, what the learner will see, where in the code to look, how to check it).
- Speak simply and avoid jargon.

## Features (one session each, in order)

Use the name in the first column for `/rename`. Tick off when committed. Times are targets from SPEC §12.

| # | Session name | What it covers | Check | Target |
|---|---|---|---|---|
| 0 | `repo-setup` | Client/server/tools skeleton, health endpoint | ✅ done | Fri 19:30 |
| 1 | `car` | Rapier car on a flat plane, cameras, all keyboard controls, speed in mph | ✅ done | Fri 22:30 |
| 2 | `osm-import` | Overpass export → roads, buildings, road graph JSON in `/assets/wanstead` | ✅ done | Fri 01:30 |
| 3 | `world-route` | Car on real roads, road colliders, traffic lights, parked cars, fixed demo route | ✅ done | Sat 10:00 |
| 4 | `directions-faults` | Spoken directions (cached Gemini TTS, Web Speech fallback) + fault engine R1–R6 | ✅ done | Sat 12:00 |
| — | **checkpoint** | Roads usable? If not, hand-build the demo junctions | — | Sat 12:00 |
| 5 | `faults-to-atlas` | R9 + R11, sessions start/end, `POST /api/events`, result screen | ✅ done | Sat 13:30 |
| 6 | `stream-heatmap` | Stream Processing → `junction_stats`, STATS19 import, instructor heatmap + collisions layer | ✅ done | Sat 15:00 |
| 7 | `debrief-rag` | Guidance ingest + autoEmbed index, Argon debrief, citation checker, debrief screen | ✅ done | Sat 17:00 |
| 8 | `tts-demo-mode` | Spoken result (TTS pipeline already built in row 4: `npm run gen-tts -w tools`), demo seed data, `R` reset | ✅ done | Sat 18:00 |
| — | **checkpoint** | Everything above working end to end? If not, fix only that | — | Sat 18:00 |
| 8b | `world-look` | Trailhead-style world built from open data: sky and shadows, textured roads with kerbs, brick buildings with roofs, windows and shop fronts, trees and parks (`npm run scenery -w tools`), lamps, walls, hedges, zebras, a hatchback with L plates. Google 3D Tiles were tried and dropped (blurry at street level) | ✅ done | — |
| 9 | `hybrid-search` | Atlas Search + `$rankFusion` + `$rerank` for the debrief's guidance (learner-facing, not the instructor search), over all Highway Code rules 103–203 tagged by keyword | ✅ done (`npm run guidance-check -w tools`) | Sat 19:30 |
| 10 | `saint-or-live` | Gemini Live "tell me" question (no Saint seat): `GET /api/live-token`, push-to-talk on T, wrong answer = R15 | ✅ done: voice run works with the new Gemini key | Sat 21:00 |
| 10b | `deploy` | Put it online at an https link judges can open: one Node app on Railway (Fastify serves the built client + API), auto-deploy from GitHub, secrets in Railway's Variables, Atlas network access open to anywhere. Build/start/healthcheck are set in Railway's Settings (config-as-code is closed to new services); see [docs/DEPLOY.md](docs/DEPLOY.md) | ✅ done: https://dry-runserver-production.up.railway.app | Sat 21:00 |
| — | **freeze** | Bug fixes only, rehearse the drive 3 times | — | Sat 21:00 |
| 11 | `submission` | README, videos, notes per track | Checklist in SPEC §14 | Sun 11:30 |

## New features: "learn your test area" (rows 12–22, on branch `v2`, one session each, in the order listed)

Plan and reasons in SPEC §16. The checkpoint build is tagged `checkpoint-2`. Work on `v2`; merge into `main` (Railway deploys `main`) only when a step works end to end. Row 11 above still ships from `main`.

**Why this order (24 Oct, 19:15):** the deadline is now midnight and the laptop keeps crashing, so rows are ranked by what judges will actually see, not by row number. The demo story is "type your test centre, drive a real route": `auto-routes` first (everything needs it), then `any-centre`, then `mock-test` to show the routes off. Above the cut line is the target; below it is bonus, and `road-users` / `manoeuvres` are skipped tonight. R7/R8 (row 13) are built but may never appear on camera, which is why polish like that now waits. Commit and push after every working step, not just at the end of a session.

| # | Session name | What it covers | Check |
|---|---|---|---|
| 12 | `early-finish` | Ending before the route is done is "test not finished", not a pass | ✅ done: Enter at 0 mph → "Test not finished" (UNFINISHED in Atlas); also on `main` |
| 13 | `observation-rules` | R7 junction observation + moving off safely (mirrors and blind spot) | ✅ done: R7 at give-ways/roundabouts (Q+E, roundabout E only), R8 moving off (M+E); rule tests + debrief cites real rules |
| 14 | `auto-routes` | Build test-style loops from the road graph (roundabout + lights + give-way), 3+ per centre | ✅ done: 4 full routes at Wanstead (`?route=auto-1`…`auto-4`), `npm run route-build -w tools`; falls back to fewer junction kinds on odd maps |
| 22 | `any-centre` | Type a centre or postcode; server builds area + routes and caches them (Overture buildings, tree heights) | ✅ done: start card finds the DVSA centre (name, postcode, district; any UK postcode via gov.uk), builds OSM map + routes in ~1 min with a loading bar (`npm run centre-build -w tools -- <text>`); Chingford, Hornchurch built live, Goodmayes pre-built. Examiner now speaks a fixed set of 34 Gemini clips (no road names) |
| 15 | `mock-test` | Route picker + "surprise me", silent examiner, independent-driving stretch, fault limit scaled to drive length | ✅ done: start card lists each centre's routes (length, turns, lights, give-ways) + "Surprise me"; pass mark scaled to route length (15 per 12 km, rounded up: 3 km allows 4), server reads the length from the route file. Independent driving skipped (blue arrows already guide) |
| — | **midnight cut line** | Done by midnight 24 Oct. If `any-centre` isn't working by ~22:30, use plan B: pre-build 2–3 centres and the postcode box picks the nearest | — |
| 17 | `practice-mode` | Instructor voice coaching in the moment, repeat a junction, free drive | ✅ done: Mock test / Practise switch on the start card (+ Free drive); in practice each fault gets a fixed spoken tip per rule (16 Gemini clips, same voice), J repeats the last junction, Enter shows "Practice drive" (never pass/fail, saved with `mode: 'practice'`). Any mode: "You've gone off the route…" after 3 s off it |
| 18 | `weak-junctions` | Learner history from Atlas, "your weak junctions" on the start screen | ✅ done: start card shows up to 3 junctions where the same fault happened on 2+ of this browser's drives ("missed the look right, 3 of 4 times", grouped in Atlas), Practise starts a practice drive 80 m before it (`&at=`); empty box says "Drive a route…" |
| 16 | `off-route` | "That's fine, take the next left", then reroute back (row 17 already says "you've gone off the route, turn round": `examiner/off-route.ts`) | Miss a turn → examiner recovers |
| 19 | `junction-tips` | Local advice per tricky junction, used in coaching and the debrief | Tips appear at the right junctions |
| 21 | `road-users` | A few cars at the roundabout and lights, pedestrians at the zebra | Faults for not giving way |
| 20 | `manoeuvres` | Parallel park / bay park / pull up on the right, emergency stop | Each one marked by code |

## For later (not scheduled)

- Add an accelerometer and move the turn signal indicator to a better spot on screen.
- The examiner's voice changes between sentences (sounds like a different person). Likely cause: sentences without cached Gemini TTS fall back to the browser voice; new routes need `npm run gen-tts -w tools`. Also make the fallback voice match (same gender).
- Light engine rev sounds.
- AI examiner panel: a small box top right showing the examiner's latest note; Esc (pause screen) expands it to show the full explanations.
- Overture building outlines (OSM + AI-traced Microsoft/Google buildings) to fill streets where OSM has no buildings; also Meta tree heights. Skipped from `any-centre` for the deadline.

## Project notes

- **It must look like the real place.** That's the moat: learners practise *their* test area, so it has to look like the streets they'll drive on test day. Otherwise it's just a random driving sim. Must-haves come first, but realism (`photoreal-tiles`) comes straight after the P0 checkpoint, before any P1 feature. Don't spend time polishing the boxy OSM look; it's the fallback.

- **The instructor heatmap (row 6) is not wanted.** It's built (Stream Processing → `junction_stats` → `/instructor` map, STATS19 crashes in Atlas), but I find it confusing and useless with one route. Don't spend more time on it or polish it; keep it only because the MongoDB track needs Stream Processing. Prefer learner-facing work and realism. Before building any feature, say plainly what the user will see and whether it'll look thin with our data.

- Run everything from the repo root: `npm run dev` (client on :5173, server on :3000), `npm run typecheck`, `npm test`.
- Secrets live in `.env` at the root (copy from `.env.example`). Never commit it.
- Raw downloads go in `tools/data/` (not committed). Processed files go in `/assets`.
- The AI never decides faults. Faults come only from the code in the fault engine (SPEC §4.6). One exception, by choice: a wrong 'tell me' answer (R15) is one driving fault, as on the real test, and Gemini Live judges the answer against the official DVSA one.
- Driving must never wait for the network. Every AI or server call runs in the background and has a fallback.
