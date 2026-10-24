import type { RuleId } from '../../../client/src/faults/types';

// The guidance the debrief may cite (SPEC §4.7 FR-D2, §10): Highway Code rules and the DVSA marking page,
// all Open Government Licence v3. `ruleIds` says which of our fault rules each one backs up: the debrief
// only searches, and the citation checker only accepts, chunks tagged with the fault's rule.

const HC = 'https://www.gov.uk/guidance/the-highway-code';
/** Every rule about the drive itself. R15, the 'tell me' question, is backed up by its own answers (tell-me.json). */
const ALL: RuleId[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R9', 'R11'];

export interface Page {
  /** File name in tools/data/guidance/. */
  file: string;
  url: string;
}

export const PAGES = {
  general: { file: 'hc-103-158.html', url: `${HC}/general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158` },
  road: { file: 'hc-159-203.html', url: `${HC}/using-the-road-159-to-203` },
  marking: { file: 'dvsa-faults.html', url: 'https://www.gov.uk/driving-test/driving-test-faults-result' },
} satisfies Record<string, Page>;

/** The Highway Code rules each page holds: all of them go in, tagged by hand (below) or by their words (tags.ts). */
export const RULE_PAGES: [page: keyof typeof PAGES, first: number, last: number][] = [
  ['general', 103, 158],
  ['road', 159, 203],
];

export interface RuleSource {
  page: keyof typeof PAGES;
  rule: number;
  ruleIds: RuleId[];
}

export const HIGHWAY_CODE: RuleSource[] = [
  { page: 'general', rule: 103, ruleIds: ['R3', 'R5', 'R6'] }, // signals: clear, in good time, not misleading
  { page: 'general', rule: 124, ruleIds: ['R1'] }, // speed limits
  { page: 'general', rule: 125, ruleIds: ['R1', 'R11'] }, // the limit is a maximum, not a target
  { page: 'general', rule: 126, ruleIds: ['R11'] }, // stopping distances
  { page: 'general', rule: 144, ruleIds: ['R1', 'R2', 'R11'] }, // careless and dangerous driving
  { page: 'general', rule: 146, ruleIds: ['R1', 'R11'] }, // adapt your driving to the road
  { page: 'road', rule: 159, ruleIds: ['R3'] }, // mirrors before signalling to move off
  { page: 'road', rule: 160, ruleIds: ['R11'] }, // keep left, be aware of other road users
  { page: 'road', rule: 161, ruleIds: ['R3', 'R4'] }, // mirrors: Mirrors – Signal – Manoeuvre
  { page: 'road', rule: 170, ruleIds: ['R4', 'R11'] }, // take extra care at junctions
  { page: 'road', rule: 175, ruleIds: ['R2'] }, // stop behind the line unless green
  { page: 'road', rule: 176, ruleIds: ['R2'] }, // never over the line on red
  { page: 'road', rule: 179, ruleIds: ['R4', 'R5', 'R6'] }, // turning right: mirrors, signal, position
  { page: 'road', rule: 180, ruleIds: ['R4'] }, // check mirrors and blind spot again before turning
  { page: 'road', rule: 182, ruleIds: ['R4', 'R5', 'R6'] }, // turning left: mirrors, signal
  { page: 'road', rule: 184, ruleIds: ['R3', 'R4', 'R5', 'R9'] }, // approaching a roundabout
  { page: 'road', rule: 185, ruleIds: ['R11'] }, // give priority to traffic from the right
  { page: 'road', rule: 186, ruleIds: ['R5', 'R6', 'R9'] }, // roundabout signals and lanes
  { page: 'road', rule: 187, ruleIds: ['R11'] }, // watch out for others on the roundabout
];

/** Pages without rule numbers: the text from `from` (an HTML snippet) up to the heading `toId`. */
export const SECTIONS = [
  {
    id: 'dvsa-fault-types',
    page: 'marking' as const,
    title: 'DVSA: driving test faults and the pass mark',
    from: '<p>There are 3 types of faults',
    toId: 'if-you-pass-your-test',
    ruleIds: ALL,
  },
];
