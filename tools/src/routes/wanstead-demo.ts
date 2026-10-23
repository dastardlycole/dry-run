import type { RouteDef } from '../route/build';

// The fixed demo route at Wanstead (SPEC §4.4 FR-R1), ~2 km / ~4 min. Starts and ends outside the test
// centre (Devon House, Hermon Hill, E11 2AW). Keeps well south of Charlie Brown's roundabout.
//   1  Hermon Hill crossroads (lights): left onto High Street
//   2  Bottom of High Street (lights): left onto the A1008
//   3  Roundabout over the A12: third exit, all the way round
//   4  Same lights: straight on into Cambridge Park
//   5  Right into Spratt Hall Road
//   6  Give way, right onto New Wanstead
//   7  Hermon Hill crossroads (lights): straight on back to the centre
export const WANSTEAD_DEMO: RouteDef = {
  id: 'demo',
  name: 'Wanstead demo route',
  waypoints: [
    'osm-node-11897534', // Hermon Hill, outside the test centre
    'osm-node-243757', // Hermon Hill / High Street / New Wanstead crossroads
    'osm-node-6918738480', // High Street / A1008 / Cambridge Park lights
    'osm-node-32899597', // roundabout entry from the A1008
    'osm-node-32899621', // roundabout exit back onto the A1008
    'osm-node-6918738480',
    'osm-node-248858815', // Cambridge Park / Spratt Hall Road
    'osm-node-5986190955', // Spratt Hall Road / New Wanstead
    'osm-node-243757',
    'osm-node-11897534',
  ],
  parkedCars: 6,
};
