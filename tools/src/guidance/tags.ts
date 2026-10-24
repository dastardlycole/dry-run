import type { RuleId } from '../../../client/src/faults/types';

// Which of our fault rules a Highway Code rule backs up, from the words in it (SPEC §4.7 FR-D2). Used for the
// rules that aren't tagged by hand in sources.ts, so the debrief has more to choose from. Plain keyword
// matching, no AI: the citation checker trusts these tags, so they must come from code we can read.

/** Each fault rule and what a guidance text must mention (every pattern in the list) to back it up. */
const KEYWORDS: Record<RuleId, RegExp[]> = {
  R1: [/speed limit|too fast|excessive speed|reduce (your )?speed|drive slowly|slow down/],
  R2: [/traffic lights?|red light|signal-controlled/, /stop line|\bred\b|\bstop\b/],
  R3: [/mirrors?/, /signal|moving off|move off|pull(ing)? out/],
  R4: [/mirrors?|blind spot|look(ing)? (all )?around/, /\bturn|junction|roundabout/],
  R5: [/signal|indicat/, /\bturn|junction|roundabout|exit/],
  R6: [/signal|indicat/, /\bturn|junction|roundabout|exit/],
  R9: [/roundabout/, /\blanes?\b/],
  R11: [/give way|priority|stopping distance|collision|parked|stationary vehicle|leave enough room/],
};

/** Things a learner never does on our route: a rule about these backs up none of our faults, whatever else it says. */
const OFF_TOPIC = /overtak|headlights|sidelights|skid|single-track|country roads|revers(e|ing)/;

export function tagRule(text: string): RuleId[] {
  const t = text.toLowerCase();
  if (OFF_TOPIC.test(t)) return [];
  return (Object.keys(KEYWORDS) as RuleId[]).filter((r) => KEYWORDS[r].every((p) => p.test(t)));
}
