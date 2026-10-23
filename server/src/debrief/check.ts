import type { DebriefFault } from './describe';

// The citation checker (SPEC §4.7 FR-D3): the verification loop around Argon. An explanation is only shown if
// it is about the fault it was asked about, cites at least one guidance chunk it was given, and every cited
// chunk is a real guidance_chunks doc tagged with the fault's rule. The end-of-test summary is held to the same
// standard against all of the test's faults. Anything else is sent back once with the reasons, then dropped.

export interface GuidanceChunk {
  _id: string;
  source: string;
  url: string;
  title: string;
  text: string;
  ruleIds: string[];
}

export interface Explanation {
  faultId: string;
  text: string;
  guidanceChunkIds: string[];
}

/** The end-of-test summary: like an explanation, but for the whole test. */
export interface Summary {
  text: string;
  guidanceChunkIds: string[];
}

export const MAX_TEXT_CHARS = 700;
export const MAX_SUMMARY_CHARS = 600;
export const MAX_CITATIONS = 3;

export type Checked = { ok: true; explanation: Explanation } | { ok: false; problems: string[] };
export type CheckedSummary = { ok: true; summary: Summary } | { ok: false; problems: string[] };

/** Problems with the text and citations, shared by both checks. `covers` says whether a chunk is about the right rules. */
function checkTextAndCitations(
  a: Record<string, unknown>,
  maxChars: number,
  given: ReadonlySet<string>,
  stored: ReadonlyMap<string, GuidanceChunk>,
  covers: (c: GuidanceChunk) => string | null,
): { text: string; ids: string[]; problems: string[] } {
  const problems: string[] = [];
  const text = typeof a.text === 'string' ? a.text.trim() : '';
  if (!text) problems.push('text is empty');
  else if (text.length > maxChars) problems.push(`text is ${text.length} characters; keep it under ${maxChars}`);

  const ids = Array.isArray(a.guidanceChunkIds) ? a.guidanceChunkIds : null;
  if (!ids || ids.length === 0) problems.push('cite at least one guidance chunk id');
  else if (ids.length > MAX_CITATIONS) problems.push(`cite at most ${MAX_CITATIONS} guidance chunks`);
  else {
    for (const id of ids) {
      if (typeof id !== 'string') problems.push('guidance chunk ids must be strings');
      else if (!given.has(id)) problems.push(`"${id}" was not one of the guidance chunks you were given`);
      else if (!stored.has(id)) problems.push(`"${id}" is not a real guidance chunk`);
      else {
        const wrong = covers(stored.get(id)!);
        if (wrong) problems.push(`"${id}" ${wrong}`);
      }
    }
    if (new Set(ids).size !== ids.length) problems.push('do not cite the same chunk twice');
  }
  return { text, ids: (ids ?? []) as string[], problems };
}

/**
 * @param answer what the model sent back (parsed JSON, not trusted)
 * @param fault the fault it was asked to explain
 * @param sessionFaultIds every fault saved for this session
 * @param given ids of the chunks put in the prompt
 * @param stored the cited chunks as loaded from guidance_chunks (missing = not a real chunk)
 */
export function checkExplanation(
  answer: unknown,
  fault: Pick<DebriefFault, '_id' | 'ruleId'>,
  sessionFaultIds: ReadonlySet<string>,
  given: ReadonlySet<string>,
  stored: ReadonlyMap<string, GuidanceChunk>,
): Checked {
  if (!answer || typeof answer !== 'object') return { ok: false, problems: ['the answer was not a JSON object'] };
  const a = answer as Record<string, unknown>;
  const problems: string[] = [];

  if (a.faultId !== fault._id) problems.push(`faultId must be "${fault._id}", the fault you were asked about`);
  else if (!sessionFaultIds.has(fault._id)) problems.push(`fault "${fault._id}" is not in this test`);

  const rest = checkTextAndCitations(a, MAX_TEXT_CHARS, given, stored, (c) =>
    c.ruleIds.includes(fault.ruleId) ? null : `is not about rule ${fault.ruleId}`,
  );
  problems.push(...rest.problems);

  if (problems.length) return { ok: false, problems };
  return { ok: true, explanation: { faultId: fault._id, text: rest.text, guidanceChunkIds: rest.ids } };
}

/**
 * The end-of-test summary. It may only cite chunks the fault explanations cited (`given`), each a real chunk
 * about at least one of the test's rules.
 */
export function checkSummary(
  answer: unknown,
  ruleIds: ReadonlySet<string>,
  given: ReadonlySet<string>,
  stored: ReadonlyMap<string, GuidanceChunk>,
): CheckedSummary {
  if (!answer || typeof answer !== 'object') return { ok: false, problems: ['the answer was not a JSON object'] };
  const { text, ids, problems } = checkTextAndCitations(answer as Record<string, unknown>, MAX_SUMMARY_CHARS, given, stored, (c) =>
    c.ruleIds.some((r) => ruleIds.has(r)) ? null : 'is not about any fault in this test',
  );
  if (problems.length) return { ok: false, problems };
  return { ok: true, summary: { text, guidanceChunkIds: ids } };
}
