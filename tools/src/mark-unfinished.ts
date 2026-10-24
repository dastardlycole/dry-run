// One-off fix for tests saved before 'UNFINISHED' existed (row 12, early-finish). Two kinds were saved
// with a PASS or FAIL they never earned:
//   - reset part-way (R): saved with abandoned: true
//   - ended early (Enter): no flag, so the only sign is a drive too short to have reached the end
// Both become result 'UNFINISHED', and lose any summary written for the old result. Shows what it would
// change; only writes with --apply.
//
//   npm run mark-unfinished -w tools              list what would change
//   npm run mark-unfinished -w tools -- --apply   change it
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { CENTRE } from '../../client/src/config';
import type { Route } from '../../client/src/world/types';
import { ASSETS_DIR } from './env';

/** Faster than anyone drives the whole route (40 mph average), so a test shorter than this ended early. */
const TOP_AVERAGE_M_PER_S = 40 * 0.44704;

const apply = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set in .env');

const route = JSON.parse(readFileSync(resolve(ASSETS_DIR, CENTRE.id, 'route-demo.json'), 'utf8')) as Route;
const shortestMs = Math.round((route.lengthM / TOP_AVERAGE_M_PER_S) * 1000);

const client = await MongoClient.connect(uri, { appName: 'dry-run-mark-unfinished' });
try {
  const sessions = client.db(process.env.MONGODB_DB ?? 'dryrun').collection('sessions');
  const notYet = { result: { $in: ['PASS', 'FAIL'] }, simulated: { $ne: true } };
  const reset = { ...notYet, abandoned: true };
  const early = {
    ...notYet,
    abandoned: { $ne: true },
    routeId: route.id,
    $expr: { $lt: [{ $subtract: ['$endedAt', '$startedAt'] }, shortestMs] },
  };
  for (const [what, filter] of [
    ['reset part-way (R)', reset],
    [`ended early (Enter, under ${Math.round(shortestMs / 1000)} s)`, early],
  ] as const) {
    const found = await sessions.find(filter, { projection: { startedAt: 1, endedAt: 1, result: 1, counts: 1 } }).toArray();
    console.log(`${what}: ${found.length}`);
    for (const s of found) {
      const secs = Math.round((s.endedAt - s.startedAt) / 1000);
      console.log(`  ${s._id}  ${s.startedAt.toISOString()}  ${secs} s  was ${s.result}  ${JSON.stringify(s.counts)}`);
    }
    if (apply && found.length) {
      // Any examiner's summary was written for the old PASS or FAIL ("well done, you've passed"), so it goes too.
      const res = await sessions.updateMany(
        { _id: { $in: found.map((s) => s._id) } },
        { $set: { result: 'UNFINISHED' }, $unset: { summary: '', debrief: '' } },
      );
      console.log(`  changed ${res.modifiedCount} to UNFINISHED`);
    }
  }
  if (!apply) console.log('Nothing changed. Run again with -- --apply to change these.');
} finally {
  await client.close();
}
