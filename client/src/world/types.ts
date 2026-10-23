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
