import type { Db } from 'mongodb';

// Rebuilds junction_stats from every saved fault, the same shape Stream Processing writes (SPEC §8). Needed
// for faults saved while the processor wasn't running, and after faults are deleted (it only sees inserts).

export async function rebuildJunctionStats(db: Db): Promise<number> {
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
  return db.collection('junction_stats').countDocuments();
}
