// Shape of assets/<centre>/world.json, written by tools/src/osm-import.ts (SPEC §4.1).
// Positions are metres from the centre: x = east, z = south (Three.js axes). Coordinates rounded to cm.

export type Vec2 = [x: number, z: number];
export type Confidence = 'high' | 'low';
export type JunctionType = 'roundabout' | 'signals' | 'giveway' | 'stop' | 'crossing' | 'plain';

export interface Road {
  /** OSM way id. A way cut by the map edge can appear more than once. */
  wayId: number;
  name?: string;
  highway: string;
  lanes: number;
  widthM: number;
  maxspeedMph: number;
  /** One-way in the direction the points run. */
  oneway: boolean;
  /** OSM layer (bridges > 0). Drawn flat for now. */
  layer: number;
  /** `low` when the width was guessed because OSM has no lanes tag (FR-W10). */
  confidence: Confidence;
  points: Vec2[];
}

export interface Building {
  heightM: number;
  footprint: Vec2[];
}

export interface Junction {
  /** Stable id from the OSM node (FR-W7), e.g. "osm-node-123". */
  id: string;
  type: JunctionType;
  pos: Vec2;
  lat: number;
  lng: number;
  /** Number of road directions meeting here. */
  degree: number;
  geometryConfidence: Confidence;
}

/** A traffic control (signals, give-way, stop, crossing) as mapped in OSM, linked to the nearest junction. */
export interface Control {
  osmId: number;
  type: Exclude<JunctionType, 'plain' | 'roundabout'>;
  pos: Vec2;
  junctionId?: string;
}

/** One direction of travel between two graph nodes (FR-W6). */
export interface Edge {
  id: string;
  from: string;
  to: string;
  wayId: number;
  lengthM: number;
  maxspeedMph: number;
  /** Part of a roundabout's ring. */
  roundabout?: boolean;
  points: Vec2[];
}

export interface GraphNode {
  id: string;
  pos: Vec2;
}

export interface WorldData {
  centre: { id: string; name: string; lat: number; lng: number; radiusM: number };
  generatedAt: string;
  roads: Road[];
  buildings: Building[];
  junctions: Junction[];
  controls: Control[];
  graph: { nodes: GraphNode[]; edges: Edge[] };
}

/** A position and the direction faced: rotation about +Y, 0 = east (+x), positive = turned left. */
export interface Pose {
  pos: Vec2;
  heading: number;
}

export type StepAction = 'left' | 'right' | 'ahead' | 'roundabout' | 'end';
export type StepControl = 'signals' | 'giveway' | 'stop' | 'roundabout' | 'none';

/** A stop or give-way line painted across the route's side of the road, from kerb `a` to `b`. */
export interface StopLine {
  kind: 'stop' | 'giveway';
  /** Distance along the route's driving line. */
  atM: number;
  a: Vec2;
  b: Vec2;
}

/** One place on the route where the examiner says something or the driver must stop/give way (SPEC §4.4). */
export interface RouteStep {
  id: string;
  /** Graph node id of the junction (same as the junction id, FR-W7). */
  junctionId: string;
  pos: Vec2;
  /** Distance along the route's driving line where the junction is. */
  atM: number;
  action: StepAction;
  /** Roundabouts: which exit to take (1 = first), and how many exits there are in all. */
  exit?: number;
  exits?: number;
  /** Signed change of heading through the junction in degrees (positive = left). */
  turnDeg: number;
  control: StepControl;
  /** Graph edge the route arrives on, and the one it leaves on. */
  approachEdgeId: string;
  exitEdgeId: string;
  fromRoad: string;
  toRoad: string;
  line?: StopLine;
}

/** A fixed test route through the road graph (assets/<centre>/route-<id>.json, from tools/src/route-build.ts). */
export interface Route {
  id: string;
  name: string;
  centreId: string;
  generatedAt: string;
  lengthM: number;
  start: Pose;
  end: Pose;
  /** Graph edge ids in driving order. */
  edges: string[];
  /** Where a car in the left lane drives, and the distance along it at each point. */
  line: Vec2[];
  lineM: number[];
  steps: RouteStep[];
  parkedCars: Pose[];
}
