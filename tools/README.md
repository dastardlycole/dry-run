# Offline tools

Run from the repo root with `npx tsx tools/src/<script>.ts`. Raw inputs go in `tools/data/` (git-ignored); processed outputs go in `/assets` or Atlas.

| Script | Input | Output | Spec |
|---|---|---|---|
| `osm-fetch` | Overpass API (centre from `client/src/config.ts`) | `tools/data/wanstead.osm.json` | §4.1 |
| `osm-import` | `tools/data/wanstead.osm.json` | `/assets/wanstead/world.json` (roads, buildings, junctions, road graph) | §4.1 |
| `import-stats19` | DfT road safety CSVs | `collisions` collection | §10 |
| `ingest-guidance` | DVSA + Highway Code pages | `guidance_chunks`, `tell_me_questions` | §4.7 |
| `gen-tts` | examiner phrase list | `/assets/audio/*.wav` | §4.5 |
| `seed-demo` | — | synthetic `sessions` + `fault_events` | §4.10 |

Map: `npm run osm-fetch -w tools` once, then `npm run osm-import -w tools` after any change to the import code.
