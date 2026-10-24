import type { CentreInfo } from './finder';

// What the learner types in the start box → a DVSA test centre. A centre's name ("wanstead", "Isleworth")
// comes from our list; a full postcode asks gov.uk for the nearest centre, anywhere in the UK; a postcode
// district ("E11") is placed with postcodes.io and gets the nearest centre on our list.

export interface FindDeps {
  centres: CentreInfo[];
  /** gov.uk finder: nearest centres to a full postcode, nearest first. */
  near: (postcode: string) => Promise<CentreInfo[]>;
  /** postcodes.io: where a full postcode or district is, or null if it doesn't exist. */
  locate: (postcode: string) => Promise<{ lat: number; lng: number } | null>;
}

/** Further than this from every centre on the list, a district isn't "near" any of them. */
export const MAX_NEAREST_KM = 30;

const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/;
const DISTRICT = /^[A-Z]{1,2}\d[A-Z\d]?$/;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  return Math.hypot(x, (b.lat - a.lat) * rad) * 6371;
}

export function nearest(centres: CentreInfo[], at: { lat: number; lng: number }): CentreInfo | null {
  let best: CentreInfo | null = null;
  for (const c of centres) if (!best || km(c, at) < km(best, at)) best = c;
  return best && km(best, at) <= MAX_NEAREST_KM ? best : null;
}

export async function findCentre(text: string, deps: FindDeps): Promise<CentreInfo | null> {
  const q = text.trim();
  if (!q) return null;
  const pc = q.toUpperCase().replace(/\s+/g, ' ');
  if (FULL_POSTCODE.test(pc)) {
    const found = await deps.near(pc).catch(() => []);
    if (found.length) return found[0];
    const at = await deps.locate(pc).catch(() => null);
    return at && nearest(deps.centres, at);
  }
  if (DISTRICT.test(pc)) {
    const at = await deps.locate(pc).catch(() => null);
    if (at) return nearest(deps.centres, at);
  }
  // A name: whole name first ("Wanstead"), then the start of one ("isle" → Isleworth (Fleming Way)).
  const s = squash(q);
  if (s.length < 3) return null;
  return deps.centres.find((c) => squash(c.name) === s || c.id.replace(/-/g, '') === s) ?? deps.centres.find((c) => squash(c.name).startsWith(s)) ?? null;
}

/** postcodes.io lookup for a full postcode or a district. */
export async function locatePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  const kind = DISTRICT.test(postcode) ? 'outcodes' : 'postcodes';
  const res = await fetch(`https://api.postcodes.io/${kind}/${encodeURIComponent(postcode)}`, { signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`postcodes.io returned ${res.status}`);
  const { result } = (await res.json()) as { result: { latitude: number; longitude: number } | null };
  return result ? { lat: result.latitude, lng: result.longitude } : null;
}
