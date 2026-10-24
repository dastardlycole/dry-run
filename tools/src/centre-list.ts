import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findNear, type CentreInfo } from './centre/finder';

// Writes tools/src/centre/centres.json: the DVSA car test centres in and around London, straight from the
// gov.uk finder (which gives the 10 nearest to a postcode), so no centre is typed in by hand.
//   npm run centre-list -w tools
const SEEDS = [
  // London, roughly a grid
  'E11 2AW', 'E4 6AD', 'N17 8JL', 'N3 1DH', 'NW4 4BT', 'NW10 7NY', 'W5 5JY', 'W12 7RQ', 'SW19 1QD',
  'SW16 6LP', 'SE9 1HB', 'SE13 6LH', 'SE18 6HX', 'CR0 2RH', 'BR1 1HD', 'HA1 1BA', 'UB8 1JX', 'TW7 4DY',
  'KT6 7EL', 'RM11 1AA', 'IG11 8SY', 'EN3 7XY', 'DA17 6LJ', 'SM1 1JA',
  // the ring of towns round it
  'CM1 1HT', 'SS1 1AA', 'AL1 3JE', 'LU1 2LE', 'GU1 4UT', 'RH1 1PT', 'ME1 1AA', 'SL1 1AA', 'CM20 1AA', 'TN13 1AA',
];

const byId = new Map<string, CentreInfo>();
for (const pc of SEEDS) {
  const near = await findNear(pc);
  for (const c of near) byId.set(c.id, c);
  console.log(`${pc.padEnd(9)} ${near.map((c) => c.name).join(', ')}`);
}
const centres = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
const out = resolve(import.meta.dirname, 'centre/centres.json');
writeFileSync(out, JSON.stringify(centres, null, 1) + '\n');
console.log(`${centres.length} car test centres → ${out}`);
