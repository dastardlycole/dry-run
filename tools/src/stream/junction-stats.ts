// Atlas Stream Processing: fault_events change stream → 10 s tumbling windows → junction_stats (SPEC §8).
// Each window's counts are ADDED to what junction_stats already holds, so totals keep growing.
// Created and started by tools/src/stream-setup.ts.

export const PROCESSOR_NAME = 'junctionStats';

export function junctionStatsPipeline(connectionName: string, db: string) {
  return [
    { $source: { connectionName, db, coll: 'fault_events' } },
    { $match: { operationType: 'insert' } },
    { $replaceRoot: { newRoot: '$fullDocument' } },
    {
      $tumblingWindow: {
        interval: { size: 10, unit: 'second' },
        // Close the window even when no later fault arrives to push it along.
        idleTimeout: { size: 10, unit: 'second' },
        allowedLateness: 0,
        pipeline: [
          {
            $group: {
              _id: { centreId: '$centreId', junctionId: '$junctionId', ruleId: '$ruleId', category: '$category' },
              faults: { $sum: 1 },
              lastUpdated: { $max: '$ts' },
            },
          },
        ],
      },
    },
    {
      $merge: {
        into: { connectionName, db, coll: 'junction_stats' },
        on: '_id',
        whenMatched: [
          {
            $set: {
              faults: { $add: ['$faults', '$$new.faults'] },
              lastUpdated: { $max: ['$lastUpdated', '$$new.lastUpdated'] },
            },
          },
        ],
        whenNotMatched: 'insert',
      },
    },
  ];
}
