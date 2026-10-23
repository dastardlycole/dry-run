# Dry Run

Solo hackathon build: a browser driving sim of the roads around Wanstead test centre (London), with an AI examiner and MongoDB Atlas. Full requirements in [SPEC.md](SPEC.md); build plan with times in SPEC §12. Build freeze **Sat 21:00**, submit **Sun 11:30** (deadline 12:00).

## How we work (remind me if I skip a step)

- One feature per session. Start with `/clear`, then `/rename <feature>`.
- Plan first for anything bigger than a small fix (Shift+Tab for plan mode). I approve the plan before code is written.
- Give every feature a check: tests, a build, or a screenshot compared to the screen file.
- Before calling it done, run `/code-review` for a fresh look, then commit.
- If Claude gets the same thing wrong twice, `/clear` and start again with a clearer request.
- At the start of a session, if I jump straight into a feature, remind me of this list in one line.
- At the end of a session (feature committed), tell me to `/clear` and name the next feature from the table below, with its `/rename` name.
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
| 8 | `tts-demo-mode` | Spoken result (TTS pipeline already built in row 4: `npm run gen-tts -w tools`), demo seed data, `R` reset | Full run from start to debrief | Sat 18:00 |
| — | **checkpoint** | Everything above working end to end? If not, fix only that | — | Sat 18:00 |
| 8b | `photoreal-tiles` | Google Photorealistic 3D Tiles as the visible world (OSM stays as the invisible logic layer); car follows real ground height; OSM look as fallback. **First thing after the P0 checkpoint, ahead of all P1 work** | Drive the route and recognise the real streets | — |
| 9 | `hybrid-search` | Atlas Search + `$rankFusion` + `$rerank` instructor search | Test queries return sensible junctions | Sat 19:30 |
| 10 | `saint-or-live` | Saint report + email (if we have a seat) **or** Gemini Live "tell me" question | Works once, start to finish | Sat 21:00 |
| — | **freeze** | Bug fixes only, rehearse the drive 3 times | — | Sat 21:00 |
| 11 | `submission` | README, videos, notes per track | Checklist in SPEC §14 | Sun 11:30 |

## Project notes

- **It must look like the real place.** That's the moat: learners practise *their* test route, so it has to look like the streets they'll drive on test day. Otherwise it's just a random driving sim. Must-haves come first, but realism (`photoreal-tiles`) comes straight after the P0 checkpoint, before any P1 feature. Don't spend time polishing the boxy OSM look; it's the fallback.

- **The instructor heatmap (row 6) is not wanted.** It's built (Stream Processing → `junction_stats` → `/instructor` map, STATS19 crashes in Atlas), but I find it confusing and useless with one route. Don't spend more time on it or polish it; keep it only because the MongoDB track needs Stream Processing. Prefer learner-facing work and realism. Before building any feature, say plainly what the user will see and whether it'll look thin with our data.

- Run everything from the repo root: `npm run dev` (client on :5173, server on :3000), `npm run typecheck`, `npm test`.
- Secrets live in `.env` at the root (copy from `.env.example`). Never commit it.
- Raw downloads go in `tools/data/` (not committed). Processed files go in `/assets`.
- The AI never decides faults. Faults come only from the code in the fault engine (SPEC §4.6).
- Driving must never wait for the network. Every AI or server call runs in the background and has a fallback.
