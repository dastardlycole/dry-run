import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { MongoClient } from 'mongodb';
import { CENTRE } from '../../client/src/config';
import type { Route, WorldData } from '../../client/src/world/types';
import { ASSETS_DIR, DATA_DIR } from './env';
import { buildJunctionDocs, nearestJunction, notAtJunction } from './junctions/build';
import { bboxAround, makeProjection } from './osm/project';
import { makeRowReader, splitCsvLine, type CollisionRow } from './stats19/parse';

// DfT STATS19 collision CSVs (tools/data/stats19/*.csv) → collisions + junctions in Atlas (SPEC §7, §10).
// Safe to run again: every doc is upserted by its id.
const STATS19_DIR = resolve(DATA_DIR, 'stats19');
/** Same reach as the roads in world.json. */
const BBOX = bboxAround(CENTRE.lat, CENTRE.lng, CENTRE.radiusM + 100);

const files = readdirSync(STATS19_DIR)
  .filter((f) => f.endsWith('.csv'))
  .map((f) => resolve(STATS19_DIR, f));
if (!files.length) throw new Error(`No CSVs in ${STATS19_DIR}. See tools/README.md for the download.`);

const rows = new Map<string, CollisionRow>();
for (const file of files) {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let read: ReturnType<typeof makeRowReader> | undefined;
  let n = 0;
  for await (const line of lines) {
    if (!line) continue;
    const fields = splitCsvLine(line);
    if (!read) {
      read = makeRowReader(fields.map((h) => h.replace(/^﻿/, '').trim()));
      continue;
    }
    n++;
    const row = read(fields, BBOX);
    if (row) rows.set(row.id, row); // the same collision in two files is kept once
  }
  console.log(`${file}: ${n} rows`);
}

const dir = resolve(ASSETS_DIR, CENTRE.id);
const world = JSON.parse(readFileSync(resolve(dir, 'world.json'), 'utf8')) as WorldData;
const routes = readdirSync(dir)
  .filter((f) => /^route-.+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Route);

const proj = makeProjection(CENTRE.lat, CENTRE.lng);
const byJunction = new Map<string, CollisionRow[]>();
const collisions = [...rows.values()].map((c) => {
  const near = notAtJunction(c) ? null : nearestJunction(proj.toLocal(c.lat, c.lng), world.junctions);
  if (near) {
    if (!byJunction.has(near.id)) byJunction.set(near.id, []);
    byJunction.get(near.id)!.push(c);
  }
  return {
    _id: c.id,
    centreId: CENTRE.id,
    date: c.date,
    severity: c.severity,
    location: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
    junctionDetail: c.junctionDetail,
    junctionControl: c.junctionControl,
    nearestJunctionId: near?.id ?? null,
  };
});

const firstYear = Math.min(...collisions.map((c) => c.date.getUTCFullYear()));
const since = collisions.length ? new Date(Date.UTC(firstYear, 0, 1)) : null;
const junctions = buildJunctionDocs(world, routes, byJunction, since);

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI not set in .env');
const client = await MongoClient.connect(uri, { appName: 'dry-run-tools' });
try {
  const db = client.db(process.env.MONGODB_DB ?? 'dryrun');
  if (collisions.length) {
    await db.collection('collisions').bulkWrite(
      collisions.map((c) => ({ replaceOne: { filter: { _id: c._id as never }, replacement: c, upsert: true } })),
    );
  }
  await db.collection('junctions').bulkWrite(
    junctions.map((j) => ({ replaceOne: { filter: { _id: j._id as never }, replacement: j, upsert: true } })),
  );
  await db.collection('collisions').createIndexes([{ key: { location: '2dsphere' } }, { key: { centreId: 1 } }]);
  await db.collection('junctions').createIndexes([{ key: { location: '2dsphere' } }, { key: { centreId: 1 } }]);
} finally {
  await client.close();
}

const linked = collisions.filter((c) => c.nearestJunctionId).length;
const sev = (s: string) => collisions.filter((c) => c.severity === s).length;
console.log(
  `${collisions.length} collisions in the area since ${firstYear} (${sev('fatal')} fatal, ${sev('serious')} serious, ${sev('slight')} slight), ` +
    `${linked} linked to a junction`,
);
console.log(`${junctions.length} junctions (${junctions.filter((j) => j.routeIds.length).length} on a route) saved`);
