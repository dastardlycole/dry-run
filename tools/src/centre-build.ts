import { resolve } from 'node:path';
import { buildCentre } from './centre/build';
import centres from './centre/centres.json';
import { findCentre, locatePostcode } from './centre/find';
import { findNear, type CentreInfo } from './centre/finder';
import { ASSETS_DIR } from './env';

// Builds the map and routes for any test centre, by name or postcode, into assets/<id>/ (or --out <dir>).
//   npm run centre-build -w tools -- "Goodmayes"
//   npm run centre-build -w tools -- "IG11 0SW"
// The server runs this same script in the background when a learner types a centre it hasn't built yet,
// passing the centre it already found in CENTRE_INFO.
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outRoot = outAt >= 0 ? args.splice(outAt, 2)[1] : ASSETS_DIR;
const text = args.join(' ');

const given = process.env.CENTRE_INFO;
const info: CentreInfo | null = given ? JSON.parse(given) : await findCentre(text, { centres, near: findNear, locate: locatePostcode });
if (!info) {
  console.error(`No test centre found for "${text}"`);
  process.exit(1);
}
console.log(`${info.name} test centre, ${info.address} ${info.postcode}`);
const routes = await buildCentre(info, resolve(outRoot, info.id));
console.log(`Built ${info.id}: ${routes.length} routes (${routes.join(', ')}) in ${resolve(outRoot, info.id)}`);
if (routes.length < 3) console.warn(`WARNING: only ${routes.length} routes (want 3+)`);
