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
- Textures and sky from [Poly Haven](https://polyhaven.com) (CC0). Trees generated with [EZ-Tree](https://github.com/dgreenheck/ez-tree) (MIT).
- Car: ["2014 Toyota Corolla E180 EU (with interior)"](https://sketchfab.com/3d-models/2014-toyota-corolla-e180-eu-with-interior-36f95efb0585464cae43a25a3b3392e8) by [Armored Wave](https://sketchfab.com/armoredwave), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Scaled, mirrored to right-hand drive and with lighter glass for the sim.
- DVSA and Highway Code guidance (gov.uk), Open Government Licence v3.
