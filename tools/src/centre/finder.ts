// Reads the results page of gov.uk "Find a driving test centre" (the official DVSA list): each centre's
// name, address, postcode and map position. Only centres that run car tests are kept.

export interface CentreInfo {
  id: string;
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
}

const FINDER_URL = 'https://www.gov.uk/find-driving-test-centre';

/** "Wanstead (London)" → "wanstead"; "Enfield (Innova Business Park)" → "enfield-innova-business-park". */
export const centreId = (name: string) =>
  name
    .replace(/\(London\)/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const textOf = (html: string, cls: string) =>
  (html.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([^<]*)<`)) ?? [])[1]?.trim().replace(/&amp;/g, '&') ?? '';

/** Centres on a results page that run car tests. */
export function parseFinder(html: string): CentreInfo[] {
  const out: CentreInfo[] = [];
  for (const item of html.split('place-list__item').slice(1)) {
    const name = item.match(/<h3[^>]*>([^<]*)</)?.[1].trim().replace(/&amp;/g, '&') ?? '';
    const pos = item.match(/mlat=(-?[\d.]+)&amp;mlon=(-?[\d.]+)/);
    const tests = item.match(/provides these types of tests:([^<]*)</)?.[1] ?? '';
    if (!name || !pos || !/\bcar\b/.test(tests)) continue;
    out.push({
      id: centreId(name),
      name: name.replace(/\s*\(London\)/i, ''),
      address: [textOf(item, 'street-address'), textOf(item, 'locality')].filter(Boolean).join(', '),
      postcode: textOf(item, 'postal-code'),
      lat: Math.round(+pos[1] * 1e6) / 1e6,
      lng: Math.round(+pos[2] * 1e6) / 1e6,
    });
  }
  return out;
}

/** The nearest test centres to a postcode, from the gov.uk finder (a form post with its token). */
export async function findNear(postcode: string): Promise<CentreInfo[]> {
  const page = await fetch(FINDER_URL, { signal: AbortSignal.timeout(10_000) });
  const cookie = page.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const token = (await page.text()).match(/name="authenticity_token" value="([^"]+)"/)?.[1];
  if (!token) throw new Error('gov.uk finder: no form token');
  const res = await fetch(FINDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ authenticity_token: token, postcode }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`gov.uk finder returned ${res.status}`);
  return parseFinder(await res.text());
}
