import type { Vec2 } from '../../../client/src/world/types';

// Local metric projection around the centre. Good to a few cm over a couple of km.
// World axes match Three.js: x = east, z = south (so north is -z), y = up.
const EARTH_R = 6371008.8;
const DEG = Math.PI / 180;


export function makeProjection(lat0: number, lng0: number) {
  const mPerDegLat = EARTH_R * DEG;
  const mPerDegLng = EARTH_R * DEG * Math.cos(lat0 * DEG);
  return {
    toLocal(lat: number, lng: number): Vec2 {
      return [(lng - lng0) * mPerDegLng, -(lat - lat0) * mPerDegLat];
    },
    toLatLng([x, z]: Vec2): [lat: number, lng: number] {
      return [lat0 - z / mPerDegLat, lng0 + x / mPerDegLng];
    },
  };
}

/** [south, west, north, east] box reaching `radiusM` from the point in each direction. */
export function bboxAround(lat: number, lng: number, radiusM: number): [number, number, number, number] {
  const dLat = radiusM / (EARTH_R * DEG);
  const dLng = radiusM / (EARTH_R * DEG * Math.cos(lat * DEG));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}
