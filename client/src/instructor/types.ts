// Shape of GET /api/junctions/stats (SPEC §4.8 FR-I1, §4.7 FR-D4). Shared by the server and the dashboard.

export type Severity = 'slight' | 'serious' | 'fatal';

export interface CollisionSummary {
  total: number;
  serious: number;
  fatal: number;
  /** Start of the STATS19 data we hold (ISO date), so the UI can say "since 2021". */
  since: string | null;
}

export interface JunctionStat {
  id: string;
  name: string;
  type: string;
  lng: number;
  lat: number;
  /** Faults here matching the filter, from junction_stats (written by Stream Processing). */
  faults: number;
  byRule: Record<string, number>;
  /** Sessions whose route passes this junction. */
  sessionsThrough: number;
  /** Of those, sessions with at least one fault here matching the filter. */
  sessionsWithFault: number;
  collisions: CollisionSummary;
}

export interface CollisionPoint {
  id: string;
  lng: number;
  lat: number;
  severity: Severity;
  date: string;
}

export interface JunctionStatsResponse {
  /** When junction_stats last changed, or null if it is empty. */
  updatedAt: string | null;
  /** Seeded demo tests (tools/src/seed-demo.ts) included in the counts. */
  simulatedSessions: number;
  junctions: JunctionStat[];
  collisions: CollisionPoint[];
}
