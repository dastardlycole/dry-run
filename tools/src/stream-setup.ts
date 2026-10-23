import { MongoClient } from 'mongodb';
import './env';
import { junctionStatsPipeline, PROCESSOR_NAME } from './stream/junction-stats';

// Creates, starts and checks the junctionStats stream processor (SPEC §8), sending the same commands
// mongosh's sp.* helpers send, so mongosh isn't needed.
//   npm run stream -w tools            drop (if there), create and start
//   npm run stream -w tools -- stats   is it running, and how many faults has it seen
//   npm run stream -w tools -- stop | drop
//   npm run stream -w tools -- backfill   rebuild junction_stats from every saved fault (the processor only
//                                        sees faults saved while it runs)
const ASP_URI = process.env.ASP_URI;
const CONNECTION = process.env.ASP_CONNECTION ?? 'dryrun-cluster';
const DB = process.env.MONGODB_DB ?? 'dryrun';
const action = process.argv[2] ?? 'create';

if (action === 'backfill') {
  const cluster = await MongoClient.connect(process.env.MONGODB_URI ?? '', { appName: 'dry-run-stream-setup' });
  try {
    const db = cluster.db(DB);
    await db.collection('junction_stats').deleteMany({});
    await db
      .collection('fault_events')
      .aggregate([
        {
          $group: {
            _id: { centreId: '$centreId', junctionId: '$junctionId', ruleId: '$ruleId', category: '$category' },
            faults: { $sum: 1 },
            lastUpdated: { $max: '$ts' },
          },
        },
        { $merge: { into: 'junction_stats', on: '_id', whenMatched: 'replace', whenNotMatched: 'insert' } },
      ])
      .toArray();
    console.log(`junction_stats rebuilt: ${await db.collection('junction_stats').countDocuments()} docs`);
  } finally {
    await cluster.close();
  }
  process.exit(0);
}

if (!ASP_URI) throw new Error('ASP_URI not set in .env (the Stream Processing workspace connection string)');

/** The workspace takes the same database user as the cluster: borrow it from MONGODB_URI if ASP_URI has none. */
function withCredentials(aspUri: string, clusterUri = process.env.MONGODB_URI ?? '') {
  const asp = new URL(aspUri);
  if (asp.username || !clusterUri) return aspUri;
  const cluster = new URL(clusterUri);
  asp.username = cluster.username;
  asp.password = cluster.password;
  if (!asp.searchParams.has('authSource')) asp.searchParams.set('authSource', 'admin');
  if (!asp.searchParams.has('tls')) asp.searchParams.set('tls', 'true');
  return asp.toString();
}

const client = await MongoClient.connect(withCredentials(ASP_URI), { appName: 'dry-run-stream-setup' });
const admin = client.db('admin');
const run = (cmd: Record<string, unknown>) => admin.command(cmd);
const exists = async () => {
  const { streamProcessors = [] } = await run({ listStreamProcessors: 1 });
  return (streamProcessors as { name: string }[]).some((p) => p.name === PROCESSOR_NAME);
};

try {
  if (action === 'create') {
    if (await exists()) {
      await run({ stopStreamProcessor: PROCESSOR_NAME }).catch(() => {});
      await run({ dropStreamProcessor: PROCESSOR_NAME });
      console.log(`Dropped the old ${PROCESSOR_NAME}`);
    }
    await run({ createStreamProcessor: PROCESSOR_NAME, pipeline: junctionStatsPipeline(CONNECTION, DB) });
    await run({ startStreamProcessor: PROCESSOR_NAME });
    console.log(`${PROCESSOR_NAME} created and started: ${DB}.fault_events → ${DB}.junction_stats (via ${CONNECTION})`);
  } else if (action === 'stats') {
    console.log(JSON.stringify(await run({ getStreamProcessorStats: PROCESSOR_NAME }), null, 2));
  } else if (action === 'stop') {
    await run({ stopStreamProcessor: PROCESSOR_NAME });
    console.log(`${PROCESSOR_NAME} stopped`);
  } else if (action === 'drop') {
    await run({ dropStreamProcessor: PROCESSOR_NAME });
    console.log(`${PROCESSOR_NAME} dropped`);
  } else throw new Error(`Unknown action ${action}: use create, stats, stop or drop`);
} finally {
  await client.close();
}
