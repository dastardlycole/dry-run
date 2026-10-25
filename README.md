# Dry Run

**Practise your real driving test, on your real test roads.** Dry Run is a browser driving simulator of the streets around any UK driving test centre, with an AI examiner that marks you like the real test.

**Live:** https://dry-runserver-production.up.railway.app (Chrome on a laptop; sound on)

## The problem
Under half of UK learner drivers pass the practical test, a fail means waiting months for another slot, and most learners take their test on roads they've never driven.

## What it does
- **Your test area:** type a test centre or postcode. It builds the real streets from OpenStreetMap (gaps filled with Overture building outlines) and makes test-style routes through real roundabouts, lights and give-ways. Wanstead, Goodmayes and Chingford are pre-built.
- **Mock test:** an examiner gives spoken directions and asks a spoken 'tell me' question. Faults are marked by rules in code, like the DVSA marking sheet (driving, serious, dangerous), and you pass or fail at the end. Missing a turn isn't a fault: the examiner finds you a way back.
- **Debrief:** every fault is explained, citing the Highway Code. Explanations appear while you drive (Examiner's notes) and in full at the end.
- **Practice mode:** spoken tips after each fault, J to repeat a junction, and "your weak junctions" from your past drives.

## How it works
- **Faults:** a rule engine marks 11 rules (speeding, red lights, mirrors, signals, junction observation, moving off, roundabout lanes, collisions, the 'tell me' answer). The AI never decides a fault; the one exception is the 'tell me' answer, judged against the official DVSA answer.
- **MongoDB Atlas:**
  - every session and fault is saved as it happens (`sessions`, `fault_events`, geo-indexed);
  - **Atlas Stream Processing** keeps live fault counts per junction (`junction_stats`);
  - **RAG:** the Highway Code and DVSA guidance are stored as chunks with **automated embedding** (Voyage `voyage-4`); **hybrid search** (`$rankFusion` of `$vectorSearch` and Atlas Search) then **`$rerank`** (`rerank-2.5`) finds the rules for each fault;
  - an **aggregation pipeline** finds your weak junctions;
  - DfT road-collision data (STATS19) is stored for the same junctions.
- **Gemini:**
  - **`gemini-3.8-live`** (Live API): the spoken 'tell me' question, with a one-use token so the API key stays on the server;
  - **`gemini-4-argon`**: writes the fault explanations and the end-of-test summary. A citation checker only shows an explanation if it cites real Highway Code rules it was given; anything else is sent back once, then dropped;
  - **`gemini-3.8-flash-tts`**: the examiner's voice (52 fixed sentences made ahead, so driving never waits for the network), plus the spoken summary.

## Responsibility
- No accounts, no camera, no personal data: each browser gets a random ID. The only location used is the test centre you type.
- The AI can't mark you and can't invent a rule. If the AI or the network fails, driving carries on and nothing is marked against you.

## Setup
Requires Node 20+.

```sh
npm install
cp .env.example .env   # fill in MONGODB_URI and GEMINI_API_KEY
npm run dev
```

- Simulator: http://localhost:5173 (try `?route=auto-1`, `?mode=practice`, `?centre=goodmayes`)
- API health: http://localhost:3000/api/health
- Tests and types: `npm test`, `npm run typecheck`
- Production: `npm run build`, then `npm start` (serves the built client and the API on one port; see [docs/DEPLOY.md](docs/DEPLOY.md))

One-off data steps (results are already in `assets/` and Atlas): `npm run <script> -w tools` with `centre-build -- "<centre or postcode>"`, `overture -- <centre>`, `route-build`, `gen-tts`, `ingest-guidance`, `import-stats19`, `stream`.

## Layout
| Folder | Contents |
|---|---|
| `client/` | Vite + TypeScript + Three.js + Rapier simulator, fault engine, examiner |
| `server/` | Fastify API, MongoDB Atlas, Gemini (debrief, Live token, TTS) |
| `tools/` | Map, route, audio and data import scripts |
| `assets/` | Built maps, routes and examiner audio served to the client |
| `docs/` | Deploy notes and old spec versions |

## Data sources
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
- Building outlines from [Overture Maps Foundation](https://overturemaps.org) (ODbL; includes OpenStreetMap, Microsoft and Google open building data).
- Test centres: DVSA (gov.uk), Open Government Licence v3. Postcode lookup: [postcodes.io](https://postcodes.io) (ONS / OS data, Open Government Licence).
- Road safety data (STATS19), Department for Transport, Open Government Licence.
- The Highway Code and DVSA guidance (gov.uk), Open Government Licence v3.
- Textures and sky from [Poly Haven](https://polyhaven.com) (CC0). Trees generated with [EZ-Tree](https://github.com/dgreenheck/ez-tree) (MIT).
- Car: ["2014 Toyota Corolla E180 EU (with interior)"](https://sketchfab.com/3d-models/2014-toyota-corolla-e180-eu-with-interior-36f95efb0585464cae43a25a3b3392e8) by [Armored Wave](https://sketchfab.com/armoredwave), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Scaled, mirrored to right-hand drive and with lighter glass for the sim.
