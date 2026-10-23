import { describe, expect, it } from 'vitest';
import { bboxAround } from '../osm/project';
import { inBBox, junctionDetailLabel, makeRowReader, parseDate, splitCsvLine, type BBox } from './parse';

const HEADER =
  'collision_index,collision_year,longitude,latitude,collision_severity,date,junction_detail_historic,junction_detail,junction_control'.split(',');
const WANSTEAD: BBox = bboxAround(51.5797, 0.0236, 1100);
const read = makeRowReader(HEADER);
const row = (s: string) => read(splitCsvLine(s), WANSTEAD);

describe('splitCsvLine', () => {
  it('splits plain and quoted fields', () => {
    expect(splitCsvLine('a,b,,c')).toEqual(['a', 'b', '', 'c']);
    expect(splitCsvLine('"x, y",2,"say ""hi"""')).toEqual(['x, y', '2', 'say "hi"']);
  });
});

describe('parseDate', () => {
  it('reads day-first dates', () => {
    expect(parseDate('03/10/2024')).toEqual(new Date('2024-10-03T00:00:00Z'));
  });
  it('rejects junk and impossible dates', () => {
    expect(parseDate('2024-10-03')).toBeNull();
    expect(parseDate('31/02/2024')).toBeNull();
  });
});

describe('junctionDetailLabel', () => {
  it('prefers the historic code, then the 2024 one', () => {
    expect(junctionDetailLabel('1', '0')).toBe('Roundabout');
    expect(junctionDetailLabel('-1', '13')).toBe('T or staggered junction');
    expect(junctionDetailLabel(undefined, '16')).toBe('Crossroads');
    expect(junctionDetailLabel('-1', '-1')).toBe('Unknown');
  });
});

describe('bbox filter', () => {
  it('keeps points inside and drops points outside', () => {
    expect(inBBox(51.5797, 0.0236, WANSTEAD)).toBe(true);
    expect(inBBox(51.6, 0.0236, WANSTEAD)).toBe(false); // ~2.3 km north
    expect(inBBox(51.5797, -0.1, WANSTEAD)).toBe(false); // central London
  });
});

describe('makeRowReader', () => {
  it('turns a Wanstead row into a collision', () => {
    expect(row('2024010X1,2024,0.0281,51.5830,2,03/10/2024,-1,13,2')).toEqual({
      id: '2024010X1',
      date: new Date('2024-10-03T00:00:00Z'),
      severity: 'serious',
      lat: 51.583,
      lng: 0.0281,
      junctionDetail: 'T or staggered junction',
      junctionControl: 'Traffic signals',
    });
  });

  it('maps severity codes', () => {
    expect(row('a,2024,0.0236,51.5797,1,01/01/2024,0,0,0')?.severity).toBe('fatal');
    expect(row('a,2024,0.0236,51.5797,3,01/01/2024,0,0,0')?.severity).toBe('slight');
  });

  it('skips rows outside the box, without coordinates, or with bad data', () => {
    expect(row('a,2024,-1.247,54.6984,2,03/10/2024,-1,0,-1')).toBeNull();
    expect(row('a,2024,NULL,NULL,2,03/10/2024,-1,0,-1')).toBeNull();
    expect(row('a,2024,0.0236,51.5797,7,03/10/2024,-1,0,-1')).toBeNull();
    expect(row('a,2024,0.0236,51.5797,2,someday,-1,0,-1')).toBeNull();
  });

  it('complains about a missing column', () => {
    expect(() => makeRowReader(['collision_index'])).toThrow(/latitude/);
  });
});
