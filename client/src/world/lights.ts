import { headingOf, wrapAngle } from './geometry';
import type { Edge, Junction, Vec2 } from './types';

// Traffic light logic (SPEC §4.3 FR-T1). Pure: no Three.js, so it can be unit tested and used by
// the red-light rule (R2) later.

/** Signal junctions this close together are one set of lights (e.g. both carriageways of a dual road). */
export const SIGNAL_SITE_M = 25;

export type Light = 'green' | 'amber' | 'red' | 'redAmber';

/** Seconds for each part of the UK sequence: green → amber → red → red+amber → green. */
export interface Timing {
  green: number;
  amber: number;
  red: number;
  redAmber: number;
}

/** Two groups of approaches take turns, with 1 s of all-red between them. */
export const JUNCTION_TIMING: Timing = { green: 12, amber: 3, red: 19, redAmber: 2 };
/** A pedestrian crossing on a straight road: mostly green, short red for people to cross. */
export const CROSSING_TIMING: Timing = { green: 20, amber: 3, red: 7, redAmber: 2 };

/** How far a stop line (and its light pole) sits back from a junction node: past the junction patch plus a 1 m gap. */
export const stopLineBackM = (patchRadiusM: number) => patchRadiusM + 1;

export const cycleOf = (t: Timing) => t.green + t.amber + t.red + t.redAmber;

/** The light `t` seconds into a cycle that starts at the beginning of green. */
export function lightAt(t: number, timing: Timing): Light {
  const c = cycleOf(timing);
  const u = ((t % c) + c) % c;
  if (u < timing.green) return 'green';
  if (u < timing.green + timing.amber) return 'amber';
  if (u < c - timing.redAmber) return 'red';
  return 'redAmber';
}

export interface SignalSite {
  /** The first signal junction's id. */
  id: string;
  nodeIds: string[];
  pos: Vec2;
}

/** Groups signal junctions that are within SIGNAL_SITE_M of each other into one site. */
export function signalSites(junctions: Junction[], linkM = SIGNAL_SITE_M): SignalSite[] {
  let groups: Junction[][] = [];
  for (const j of junctions) {
    if (j.type !== 'signals') continue;
    const near = (g: Junction[]) => g.some((o) => Math.hypot(o.pos[0] - j.pos[0], o.pos[1] - j.pos[1]) < linkM);
    const merged = [j, ...groups.filter(near).flat()];
    groups = [...groups.filter((g) => !near(g)), merged];
  }
  return groups.map((g) => {
    g.sort((a, b) => junctions.indexOf(a) - junctions.indexOf(b));
    const n = g.length;
    return {
      id: g[0].id,
      nodeIds: g.map((j) => j.id),
      pos: [g.reduce((s, j) => s + j.pos[0], 0) / n, g.reduce((s, j) => s + j.pos[1], 0) / n],
    };
  });
}

/** Heading of travel at the end of an edge (over its last few metres). */
export function arrivalHeading(e: Edge, sampleM = 12): number {
  const pts = e.points;
  const end = pts[pts.length - 1];
  let i = pts.length - 2;
  while (i > 0 && Math.hypot(end[0] - pts[i][0], end[1] - pts[i][1]) < sampleM) i--;
  return headingOf(end[0] - pts[i][0], end[1] - pts[i][1]);
}

export interface Approach {
  siteId: string;
  edge: Edge;
  /** Which group of approaches this one goes with: 0 or 1. */
  group: 0 | 1;
}

export interface SiteLights {
  site: SignalSite;
  approaches: Approach[];
  timing: Timing;
  /** Seconds added to the clock so neighbouring sites aren't in step. */
  offset: number;
}

/**
 * Lights for every signal site: one per road entering the site. Roads entering along roughly the same
 * line (either direction) share a group. A site where every road is on one line is a pedestrian crossing.
 */
export function buildSiteLights(sites: SignalSite[], edges: Edge[], isService: (e: Edge) => boolean): SiteLights[] {
  return sites.map((site, i) => {
    const inSite = new Set(site.nodeIds);
    const entering = edges.filter((e) => inSite.has(e.to) && !inSite.has(e.from) && !isService(e));
    const axis = entering.length ? arrivalHeading(entering[0]) : 0;
    const approaches = entering.map((edge): Approach => {
      // Angle to the axis, ignoring direction: 0 = same line, π/2 = across it.
      const off = Math.abs(wrapAngle(2 * (arrivalHeading(edge) - axis))) / 2;
      return { siteId: site.id, edge, group: off < Math.PI / 4 ? 0 : 1 };
    });
    const timing = approaches.some((a) => a.group === 1) ? JUNCTION_TIMING : CROSSING_TIMING;
    return { site, approaches, timing, offset: (i * 7) % cycleOf(timing) };
  });
}

/** Light shown to each approach at sim time `t` seconds. Group 1 runs half a cycle behind group 0. */
export class TrafficLights {
  private byEdge = new Map<string, { s: SiteLights; a: Approach }>();
  private bySite = new Map<string, SiteLights>();

  constructor(readonly sites: SiteLights[]) {
    for (const s of sites) {
      this.bySite.set(s.site.id, s);
      for (const a of s.approaches) this.byEdge.set(a.edge.id, { s, a });
    }
  }

  /** The light facing a car arriving on `edgeId`, or undefined if that road has no lights. */
  stateFor(edgeId: string, t: number): Light | undefined {
    const hit = this.byEdge.get(edgeId);
    if (!hit) return undefined;
    return siteLight(hit.s, hit.a.group, t);
  }

  site(id: string) {
    return this.bySite.get(id);
  }
}

export function siteLight(s: SiteLights, group: 0 | 1, t: number): Light {
  // Two groups take turns, half a cycle apart; a crossing has only group 0.
  const half = s.approaches.some((a) => a.group === 1) ? cycleOf(s.timing) / 2 : 0;
  return lightAt(t + s.offset - (group === 1 ? half : 0), s.timing);
}
