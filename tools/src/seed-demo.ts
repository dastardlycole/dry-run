// Simulated past tests on the demo route (SPEC §4.10), so the debrief's "N of M tests here had a fault" has
// real-looking numbers. Written straight into Atlas, not through POST /api/events, so no Argon calls are made.
// Safe to run again: anything marked `simulated: true` is deleted first.
//
//   npm run seed-demo -w tools               replace the simulated data
//   npm run seed-demo -w tools -- --remove   delete it and stop
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { CENTRE } from '../../client/src/config';
import { makeProjection } from '../../client/src/world/projection';
import type { Route } from '../../client/src/world/types';
import { ASSETS_DIR } from './env';
import { buildSeed } from './seed/build';
import { rebuildJunctionStats } from './stream/backfill';

/** Long enough for a running stream processor to close its window (10 s + 10 s idle) on the new faults. */
const STREAM_SETTLE_MS = 25_000;

const remove = process.argv.includes('--remove');
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set in .env');

const client = await MongoClient.connect(uri, { appName: 'dry-run-seed-demo' });
try {
  const db = client.db(process.env.MONGODB_DB ?? 'dryrun');
  const simulated = { simulated: true };
  const gone = await Promise.all(['fault_events', 'sessions', 'learners'].map((c) => db.collection(c).deleteMany(simulated)));
  console.log(`removed ${gone[1].deletedCount} simulated tests and ${gone[0].deletedCount} faults`);

  if (!remove) {
    const route = JSON.parse(readFileSync(resolve(ASSETS_DIR, CENTRE.id, 'route-demo.json'), 'utf8')) as Route;
    const seed = buildSeed(route, { centreId: CENTRE.id, now: new Date(), toLatLng: makeProjection(CENTRE.lat, CENTRE.lng).toLatLng });
    await db.collection('learners').insertMany(seed.learners as never[]);
    await db.collection('sessions').insertMany(seed.sessions as never[]);
    await db.collection('fault_events').insertMany(seed.events as never[]);
    const passes = seed.sessions.filter((s) => s.result === 'PASS').length;
    console.log(`added ${seed.sessions.length} simulated tests (${passes} passes) and ${seed.events.length} faults`);
    // If Stream Processing is running it counts these too; rebuilding after it has, not before, avoids counting twice.
    console.log('waiting for Stream Processing to catch up…');
    await new Promise((r) => setTimeout(r, STREAM_SETTLE_MS));
  }
  console.log(`junction_stats rebuilt: ${await rebuildJunctionStats(db)} docs`);
} finally {
  await client.close();
}
