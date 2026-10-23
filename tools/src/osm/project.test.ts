import { describe, expect, it } from 'vitest';
import { bboxAround, makeProjection } from './project';

const LAT = 51.5797;
const LNG = 0.0236;

describe('makeProjection', () => {
  const p = makeProjection(LAT, LNG);

  it('puts the centre at the origin, north at -z and east at +x', () => {
    expect(p.toLocal(LAT, LNG).map(Math.abs)).toEqual([0, 0]);
    const [x, z] = p.toLocal(LAT + 0.001, LNG + 0.001);
    expect(x).toBeGreaterThan(0);
    expect(z).toBeLessThan(0);
  });

  it('measures about 111 m per 0.001° of latitude', () => {
    expect(-p.toLocal(LAT + 0.001, LNG)[1]).toBeCloseTo(111.2, 0);
  });

  it('round-trips back to lat/lng', () => {
    const [lat, lng] = p.toLatLng(p.toLocal(51.58, 0.03));
    expect(lat).toBeCloseTo(51.58, 9);
    expect(lng).toBeCloseTo(0.03, 9);
  });
});

describe('bboxAround', () => {
  it('reaches the radius in each direction', () => {
    const [s, w, n, e] = bboxAround(LAT, LNG, 1000);
    const p = makeProjection(LAT, LNG);
    expect(p.toLocal(n, LNG)[1]).toBeCloseTo(-1000, 3);
    expect(p.toLocal(s, LNG)[1]).toBeCloseTo(1000, 3);
    expect(p.toLocal(LAT, e)[0]).toBeCloseTo(1000, 3);
    expect(p.toLocal(LAT, w)[0]).toBeCloseTo(-1000, 3);
  });
});
