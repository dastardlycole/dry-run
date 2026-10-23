# Offline tools

Run from the repo root with `npx tsx tools/src/<script>.ts`. Raw inputs go in `tools/data/` (git-ignored); processed outputs go in `/assets` or Atlas.

| Script | Input | Output | Spec |
|---|---|---|---|
| `osm-fetch` | Overpass API (centre from `client/src/config.ts`) | `tools/data/wanstead.osm.json` | §4.1 |
| `osm-import` | `tools/data/wanstead.osm.json` | `/assets/wanstead/world.json` (roads, buildings, junctions, road graph) | §4.1 |
| `route-build` | `/assets/wanstead/world.json` + `src/routes/wanstead-demo.ts` | `/assets/wanstead/route-demo.json` (path, driving line, steps for directions, stop/give-way lines, parked cars) | §4.4 |
| `import-stats19` | `tools/data/stats19/*.csv` + `/assets/wanstead/world.json` + `route-*.json` | `collisions` + `junctions` collections (safe to re-run) | §7, §10 |
| `stream` | `src/stream/junction-stats.ts` | Atlas Stream Processor `junctionStats`: `fault_events` → `junction_stats` | §8 |
| `ingest-guidance` | DVSA + Highway Code pages | `guidance_chunks`, `tell_me_questions` | §4.7 |
| `gen-tts` | examiner phrase list | `/assets/audio/*.wav` | §4.5 |
| `seed-demo` | — | synthetic `sessions` + `fault_events` | §4.10 |

Map: `npm run osm-fetch -w tools` once, then `npm run osm-import -w tools` after any change to the import code, then `npm run route-build -w tools` (the route uses graph ids from `world.json`).

## STATS19 collisions

Download DfT's collision file (≈100 MB, Open Government Licence) into `tools/data/stats19/`, then import:

```
curl -o tools/data/stats19/collisions-last-5-years.csv https://data.dft.gov.uk/road-accidents-safety-data/dft-road-casualty-statistics-collision-last-5-years.csv
npm run import-stats19 -w tools
```

Codes (severity, junction detail/control) come from the DfT data guide on https://www.gov.uk/government/statistics/road-safety-data.

## Stream Processing (junction_stats)

One-off setup in Atlas:
1. Stream Processing → your workspace → **Connection Registry** → Add connection → Atlas Database → pick the cluster, name it `dryrun-cluster` (or set `ASP_CONNECTION`).
2. Workspace → **Connect** → copy the connection string into `.env` as `ASP_URI` (user/password are borrowed from `MONGODB_URI` if left out).

Then:

```
npm run stream -w tools               # drop (if there), create and start junctionStats
npm run stream -w tools -- stats      # check it's running
npm run stream -w tools -- backfill   # rebuild junction_stats from all saved faults (faults saved while the processor was off)
```
