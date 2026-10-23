import type { Severity } from '../../../client/src/instructor/types';

// DfT road safety data (STATS19) collision rows → our collisions docs (SPEC §7, §10).
// Codes from the DfT open data guide (2025 edition). The 2024 spec renumbered junction_detail and kept the old
// codes in junction_detail_historic, so we read whichever one the row has.

export interface CollisionRow {
  id: string;
  date: Date;
  severity: Severity;
  lat: number;
  lng: number;
  junctionDetail: string;
  junctionControl: string;
}

/** [south, west, north, east] */
export type BBox = [number, number, number, number];

const SEVERITY: Record<string, Severity> = { '1': 'fatal', '2': 'serious', '3': 'slight' };

const JUNCTION_DETAIL_HISTORIC: Record<string, string> = {
  '0': 'Not at junction or within 20 metres',
  '1': 'Roundabout',
  '2': 'Mini-roundabout',
  '3': 'T or staggered junction',
  '5': 'Slip road',
  '6': 'Crossroads',
  '7': 'More than 4 arms (not roundabout)',
  '8': 'Private drive or entrance',
  '9': 'Other junction',
};

const JUNCTION_DETAIL: Record<string, string> = {
  '0': 'Not at junction or within 20 metres',
  '13': 'T or staggered junction',
  '16': 'Crossroads',
  '17': 'More than 4 arms (not roundabout)',
  '18': 'Private drive or entrance',
  '19': 'Other junction',
};

const JUNCTION_CONTROL: Record<string, string> = {
  '0': 'Not at junction or within 20 metres',
  '1': 'Authorised person',
  '2': 'Traffic signals',
  '3': 'Stop sign',
  '4': 'Give way or uncontrolled',
};

const UNKNOWN = 'Unknown';

/** Splits one CSV line, allowing for "quoted, fields" and "" inside quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function junctionDetailLabel(historic: string | undefined, current: string | undefined): string {
  return JUNCTION_DETAIL_HISTORIC[historic ?? ''] ?? JUNCTION_DETAIL[current ?? ''] ?? UNKNOWN;
}

export const junctionControlLabel = (code: string | undefined) => JUNCTION_CONTROL[code ?? ''] ?? UNKNOWN;

/** "03/10/2024" (day first) → a UTC date, or null if it isn't one. */
export function parseDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return d.getUTCMonth() === Number(m[2]) - 1 ? d : null;
}

export const inBBox = (lat: number, lng: number, [s, w, n, e]: BBox) => lat >= s && lat <= n && lng >= w && lng <= e;

/** Reads rows given the header line. Returns null for rows outside the box or with missing data. */
export function makeRowReader(header: string[]) {
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`STATS19 CSV has no ${name} column`);
    return i;
  };
  const idx = {
    id: col('collision_index'),
    lat: col('latitude'),
    lng: col('longitude'),
    severity: col('collision_severity'),
    date: col('date'),
    detailHistoric: header.indexOf('junction_detail_historic'),
    detail: col('junction_detail'),
    control: col('junction_control'),
  };
  return (fields: string[], bbox: BBox): CollisionRow | null => {
    const lat = Number.parseFloat(fields[idx.lat]);
    const lng = Number.parseFloat(fields[idx.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBBox(lat, lng, bbox)) return null;
    const severity = SEVERITY[fields[idx.severity]];
    const date = parseDate(fields[idx.date] ?? '');
    const id = fields[idx.id]?.trim();
    if (!severity || !date || !id) return null;
    return {
      id,
      date,
      severity,
      lat,
      lng,
      junctionDetail: junctionDetailLabel(idx.detailHistoric >= 0 ? fields[idx.detailHistoric] : undefined, fields[idx.detail]),
      junctionControl: junctionControlLabel(fields[idx.control]),
    };
  };
}
