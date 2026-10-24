import type { WorldData } from '../../../client/src/world/types';
import { bboxAround } from './project';

// The two Overpass downloads for a centre (SPEC §4.1): roads and buildings, then scenery. Shared by the
// Wanstead scripts (osm-fetch, scenery) and the any-centre build.

export type Centre = WorldData['centre'];

/** The main Overpass server, then public mirrors: the main one turns queries away when it's busy. */
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
/** Rounds through all the servers before giving up, with a pause between rounds. */
const ROUNDS = 3;
const ROUND_PAUSE_MS = 5000;

/** Roads run a little past the building radius so the edge of the map isn't ragged. */
export const roadExtentM = (c: Centre) => c.radiusM + 100;
/** Scenery reaches a bit past the roads so the edge of the map isn't bare. */
export const sceneryExtentM = (c: Centre) => c.radiusM + 300;

const bboxOf = (c: Centre, radiusM: number) => bboxAround(c.lat, c.lng, radiusM).join(',');

export function roadsQuery(c: Centre): string {
  const bbox = bboxOf(c, c.radiusM);
  return `
[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$"](${bbox});
  way["building"](${bbox});
  node["highway"~"^(traffic_signals|give_way|stop|crossing|mini_roundabout)$"](${bbox});
);
out body;
>;
out skel qt;
`;
}

export function sceneryQuery(c: Centre): string {
  const bbox = bboxOf(c, sceneryExtentM(c));
  const green = '["natural"~"^(wood|scrub|heath|water)$"]';
  const land = '["landuse"~"^(forest|grass|meadow|recreation_ground|village_green|allotments|cemetery|reservoir|basin)$"]';
  const leisure = '["leisure"~"^(park|common|garden|pitch|golf_course)$"]';
  return `
[out:json][timeout:180];
(
  node["natural"="tree"](${bbox});
  way["natural"="tree_row"](${bbox});
  way${green}(${bbox}); way${land}(${bbox}); way${leisure}(${bbox});
  relation${green}(${bbox}); relation${land}(${bbox}); relation${leisure}(${bbox});
  node["highway"="street_lamp"](${bbox});
);
out body;
>;
out skel qt;
`;
}

/** Runs an Overpass query and returns the raw JSON text, trying the mirrors when a server is busy. */
export async function overpass(query: string): Promise<string> {
  let last: unknown;
  for (let round = 0; round < ROUNDS; round++) {
    if (round) await new Promise((r) => setTimeout(r, ROUND_PAUSE_MS * round));
    for (const url of OVERPASS_URLS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'dry-run-hackathon' },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(200_000),
        });
        const text = await res.text();
        // A busy server can answer 200 with an error instead of data ("runtime error: ... timed out").
        if (res.ok && text.trimStart().startsWith('{') && !/"remark":\s*"runtime error/.test(text)) return text;
        last = new Error(`${new URL(url).host} returned ${res.status}: ${text.slice(0, 200)}`);
      } catch (err) {
        last = err;
      }
      console.warn(`Overpass: ${String(last).split('\n')[0]}; trying the next server`);
    }
  }
  throw last;
}
