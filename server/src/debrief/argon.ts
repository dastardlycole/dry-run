import { GoogleGenAI } from '@google/genai';
import { wouldFail, type Result } from '../../../client/src/faults/result';
import { RULE_NAMES } from '../../../client/src/faults/types';
import { MAX_CITATIONS, MAX_SUMMARY_CHARS, MAX_TEXT_CHARS, type Explanation, type GuidanceChunk } from './check';
import { describeFault, type DebriefFault } from './describe';

// gemini-4-argon (SPEC §4.7 FR-D2, §9), through the Interactions API: one explanation per fault, and a short
// summary of the whole test at the end. Answers are JSON the citation checker then looks at; they are never
// shown unchecked.

export const MODEL = 'gemini-4-argon';
export const TIMEOUT_MS = 25_000;

export interface ExplainRequest {
  fault: DebriefFault;
  /** The junction's name, if known. */
  place?: string;
  chunks: GuidanceChunk[];
  /** Why the last answer was turned down, when this is the second try. */
  problems?: string[];
}

export interface SummaryRequest {
  result: Result;
  counts: { driving: number; serious: number; dangerous: number };
  /** Every fault, with its checked explanation where there is one. */
  faults: { fault: DebriefFault; place?: string; explanation: Explanation | null }[];
  /** The chunks the explanations cite: the only ones the summary may cite. */
  chunks: GuidanceChunk[];
  problems?: string[];
}

/** Each returns the model's answer, parsed if it is JSON (unchecked). They throw only when the call itself fails. */
export interface DebriefAI {
  explain(req: ExplainRequest): Promise<unknown>;
  summarise(req: SummaryRequest): Promise<unknown>;
}

const EXAMINER = `You are a calm, encouraging UK driving examiner giving a learner their debrief after a practice driving test.
Faults have already been marked by the test software. Never question or change them; explain them.
Write in plain British English, speaking to the learner as "you". No markdown, no headings, no quotes from the guidance longer than a few words.`;

const EXPLAIN_SYSTEM = `${EXAMINER}
For the fault you are given, write 2-3 short sentences (under ${MAX_TEXT_CHARS} characters):
why it counts as a fault on the test, and exactly what to do differently next time.
Base what you say only on the guidance chunks provided, and cite the ids of the 1-${MAX_CITATIONS} chunks you used. Only cite ids from the list given.`;

const SUMMARY_SYSTEM = `${EXAMINER}
Write the examiner's overall summary of the test in 2-3 short sentences (under ${MAX_SUMMARY_CHARS} characters):
how it went, the one or two habits that matter most (look for patterns, e.g. the same fault more than once), and what to practise next.
Cite the ids of the 1-${MAX_CITATIONS} guidance chunks that back up the main point. Only cite ids from the list given.`;

const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    faultId: { type: 'string' },
    text: { type: 'string' },
    guidanceChunkIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_CITATIONS },
  },
  required: ['faultId', 'text', 'guidanceChunkIds'],
};

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    guidanceChunkIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_CITATIONS },
  },
  required: ['text', 'guidanceChunkIds'],
};

const chunkList = (chunks: GuidanceChunk[]) => ['Guidance chunks (cite by id):', ...chunks.map((c) => `[${c._id}] ${c.title}\n${c.text}`)];
const retry = (problems?: string[]) =>
  problems?.length ? ['', 'Your last answer was rejected by the citation checker because:', ...problems.map((p) => `- ${p}`), 'Fix these.'] : [];

export function explainPrompt({ fault, place, chunks, problems }: ExplainRequest): string {
  return [
    `Fault id: ${fault._id}`,
    `What happened: ${describeFault(fault)}`,
    ...(place ? [`Where: ${place}`] : []),
    '',
    ...chunkList(chunks),
    ...retry(problems),
  ].join('\n');
}

export function summaryPrompt({ result, counts, faults, chunks, problems }: SummaryRequest): string {
  return [
    `Result: ${result} (${counts.driving} driving, ${counts.serious} serious, ${counts.dangerous} dangerous faults; a pass allows up to 15 driving faults and no serious or dangerous ones)`,
    ...(result === 'UNFINISHED'
      ? [
          `The learner ended the test before the end of the route, so this test has no result: talk about the faults so far and never say they passed or failed. ${
            wouldFail(counts)
              ? "Their faults so far would already have been a fail if the test had gone on: say that plainly, in those terms ('this would have been a fail')."
              : "Don't guess whether they would have passed."
          }`,
        ]
      : []),
    '',
    'Faults in the order they happened:',
    ...faults.map(
      ({ fault, place, explanation }, i) =>
        `${i + 1}. ${RULE_NAMES[fault.ruleId]}${place ? ` at ${place}` : ''}: ${describeFault(fault)}${explanation ? `\n   Examiner's note: ${explanation.text}` : ''}`,
    ),
    '',
    ...chunkList(chunks),
    ...retry(problems),
  ].join('\n');
}

export function argonAI(apiKey: string): DebriefAI {
  const ai = new GoogleGenAI({ apiKey });
  const ask = async (system_instruction: string, input: string, schema: object) => {
    const res = await ai.interactions.create(
      {
        model: MODEL,
        system_instruction,
        input,
        generation_config: { thinking_level: 'medium' },
        response_format: { type: 'text', mime_type: 'application/json', schema },
      },
      { timeout_ms: TIMEOUT_MS },
    );
    // Broken JSON goes to the checker like any other bad answer (and gets the second try).
    try {
      return JSON.parse(res.output_text ?? '');
    } catch {
      return res.output_text ?? null;
    }
  };
  return {
    explain: (req) => ask(EXPLAIN_SYSTEM, explainPrompt(req), EXPLAIN_SCHEMA),
    summarise: (req) => ask(SUMMARY_SYSTEM, summaryPrompt(req), SUMMARY_SCHEMA),
  };
}
