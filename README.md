# Dry Run

Browser-based 3D simulator of the roads around a UK driving test centre (Wanstead, London), with an AI examiner, a deterministic fault engine and a MongoDB Atlas-backed map of where learners fail. See [SPEC.md](SPEC.md).

## Setup

Requires Node 20+.

```sh
npm install
cp .env.example .env   # fill in MONGODB_URI and GEMINI_API_KEY
npm run dev
```

- Simulator: http://localhost:5173
- Instructor dashboard: http://localhost:5173/instructor.html
- API health: http://localhost:3000/api/health

## Layout

| Folder | Contents |
|---|---|
| `client/` | Vite + TypeScript + Three.js + Rapier simulator and MapLibre instructor dashboard |
| `server/` | Fastify API, MongoDB Atlas, Gemini |
| `tools/` | Offline import scripts (OSM, STATS19, guidance, TTS, demo seed) |
| `assets/` | Processed map and audio assets served to the client |
| `docs/` | Notes and old spec versions |

## Data sources

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
- Road safety data (STATS19), Department for Transport, Open Government Licence.
- DVSA and Highway Code guidance (gov.uk), Open Government Licence v3.
