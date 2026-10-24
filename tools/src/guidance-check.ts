import type { FastifyBaseLogger } from 'fastify';
import { MongoClient } from 'mongodb';
import type { DebriefFault } from '../../server/src/debrief/describe';
import { hybridGuidance, runStep, type Step } from '../../server/src/debrief/retrieve';
import './env';

// Shows what the debrief's guidance search finds for some typical faults: the old way (plain vector search)
// next to the new one (hybrid $rankFusion + $rerank, falling back as the server does) (SPEC §4.7 FR-D2, §8).
//   npm run guidance-check -w tools

const fault = (ruleId: DebriefFault['ruleId'], context: Record<string, unknown>, speedMph = 15): DebriefFault => ({
  _id: `check-${ruleId}`,
  ruleId,
  category: 'driving',
  junctionId: 'check',
  speedMph,
  context,
});

const EXAMPLES: { label: string; fault: DebriefFault; junctionType?: string }[] = [
  { label: 'No signal at a roundabout', fault: fault('R5', { expected: 'right', action: 'roundabout', exit: 3 }), junctionType: 'roundabout' },
  { label: 'Wrong lane on a roundabout', fault: fault('R9', { lane: 1, lanes: 2, expectedLane: 2, action: 'roundabout', exit: 3 }), junctionType: 'roundabout' },
  { label: 'Signalled left, turned right', fault: fault('R6', { shown: 'left', expected: 'right', action: 'right' }), junctionType: 'giveway' },
  { label: 'Ran a red light', fault: fault('R2', { light: 'red' }, 22), junctionType: 'signals' },
  { label: 'Speeding past a crossing', fault: fault('R1', { limitMph: 30 }, 41), junctionType: 'crossing' },
  { label: 'No mirrors before turning right', fault: fault('R4', { action: 'right' }), junctionType: 'giveway' },
  { label: "Didn't look either way at a give-way", fault: fault('R7', { action: 'right', missed: ['left', 'right'] }), junctionType: 'giveway' },
  { label: "Didn't look right entering a roundabout", fault: fault('R7', { action: 'roundabout', exit: 3, missed: ['right'] }), junctionType: 'roundabout' },
  { label: 'Pulled away without a shoulder check', fault: fault('R8', { missed: ['right'] }, 4) },
  { label: 'Indicated without mirrors', fault: fault('R3', { indicator: 'left' }) },
  { label: 'Hit a parked car', fault: fault('R11', { with: 'parkedCar' }, 18) },
  {
    label: "Didn't know how to check the brake lights",
    fault: fault('R15', { question: 'Tell me how you’d check the brake lights are working on this car.', reason: 'You need the brake pedal plus reflections or a helper.' }, 0),
  },
  {
    label: 'Wrong about tyre tread',
    fault: fault('R15', { question: 'Tell me how you’d check the tyres to ensure that they have sufficient tread depth and that their general condition is safe to use on the road.', reason: 'The legal minimum is 1.6mm.' }, 0),
  },
];

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI not set in .env');
const client = await MongoClient.connect(uri, { appName: 'dry-run-guidance-check' });
try {
  const db = client.db(process.env.MONGODB_DB ?? 'dryrun');
  // The server's search, noting which step answered.
  let used: Step | undefined;
  const log = { warn: (o: { step: Step; err: Error }) => console.log(`(${o.step} not available: ${o.err.message.slice(0, 160)})`) };
  const find = hybridGuidance((d, step, f, type) => {
    used = step;
    return runStep(d, step, f, type);
  })(db, log as unknown as FastifyBaseLogger);
  const short = (t: string) => t.replace('Highway Code ', '').replace('DVSA: driving test faults and the pass mark', 'DVSA marking');
  for (const ex of EXAMPLES) {
    // The old way: vector search, no place in the query.
    const before = await runStep(db, 'vector', ex.fault);
    const after = await find(ex.fault, ex.junctionType);
    console.log(`\n${ex.label} (${ex.fault.ruleId}${ex.junctionType ? `, ${ex.junctionType}` : ''})`);
    console.log(`  before (vector):  ${before.map((c) => short(c.title)).join(' · ')}`);
    console.log(`  after  (${used}):`.padEnd(19) + after.map((c) => short(c.title)).join(' · '));
  }
} finally {
  await client.close();
}
