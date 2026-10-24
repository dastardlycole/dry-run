import type { FastifyBaseLogger } from 'fastify';
import type { Db, Document } from 'mongodb';
import type { JunctionType } from '../../../client/src/world/types';
import type { GuidanceChunk } from './check';
import { describeFault, type DebriefFault } from './describe';

// RAG retrieval (SPEC §4.7 FR-D2, §8). Hybrid search over guidance_chunks: $rankFusion of $vectorSearch (Atlas
// embeds `text` itself with Voyage) and Atlas Search ($search, for exact words like "mini-roundabout"), then
// Voyage $rerank picks the best few. Only chunks tagged with the fault's rule can come back. If a step isn't
// available ($rerank is a project setting), it falls back: hybrid without rerank, then plain vector search.

export const GUIDANCE_INDEX = 'guidance_vector';
export const GUIDANCE_TEXT_INDEX = 'guidance_text';
export const GUIDANCE_LIMIT = 4;
/** How many chunks each search hands on to the next step. */
const CANDIDATES = 12;
export const RERANK_MODEL = 'rerank-2.5';

/** `junctionType` is the junction's type from the junctions collection ("roundabout", "signals", …), if known. */
export type FindGuidance = (fault: DebriefFault, junctionType?: string) => Promise<GuidanceChunk[]>;

const PLACE: Partial<Record<JunctionType, string>> = {
  roundabout: 'at a roundabout',
  signals: 'at traffic lights',
  giveway: 'at a give way junction',
  stop: 'at a stop junction',
  crossing: 'at a pedestrian crossing',
};

/** What happened and where, in words: the search query. */
export function guidanceQuery(fault: DebriefFault, junctionType?: string): string {
  const what = describeFault(fault);
  const place = PLACE[junctionType as JunctionType];
  // Roundabout faults already say "at a roundabout".
  return place && !what.includes(place) ? `${what} This happened ${place}.` : what;
}

/** Each way of searching, best first. */
export const STEPS = ['rerank', 'hybrid', 'vector'] as const;
export type Step = (typeof STEPS)[number];

/** The aggregation pipeline for one step. */
export function guidancePipeline(step: Step, fault: DebriefFault, junctionType?: string): Document[] {
  const what = guidanceQuery(fault, junctionType);
  const vector = (limit: number) => ({
    $vectorSearch: {
      index: GUIDANCE_INDEX,
      path: 'text',
      query: { text: `How to avoid this fault on the UK driving test. ${what}` },
      filter: { ruleIds: fault.ruleId },
      numCandidates: 50,
      limit,
    },
  });
  const project = { $project: { source: 1, url: 1, title: 1, text: 1, ruleIds: 1 } };
  if (step === 'vector') return [vector(GUIDANCE_LIMIT), project];

  const hybrid = [
    {
      $rankFusion: {
        input: {
          pipelines: {
            vector: [vector(CANDIDATES)],
            text: [
              {
                $search: {
                  index: GUIDANCE_TEXT_INDEX,
                  compound: {
                    must: [{ text: { query: what, path: ['title', 'text'] } }],
                    filter: [{ equals: { path: 'ruleIds', value: fault.ruleId } }],
                  },
                },
              },
              { $limit: CANDIDATES },
            ],
          },
        },
      },
    },
  ];
  if (step === 'hybrid') return [...hybrid, { $limit: GUIDANCE_LIMIT }, project];
  return [
    ...hybrid,
    { $limit: CANDIDATES },
    { $rerank: { query: { text: what }, path: 'text', model: RERANK_MODEL, numDocsToRerank: CANDIDATES } },
    { $limit: GUIDANCE_LIMIT },
    project,
  ];
}

export const runStep = (db: Db, step: Step, fault: DebriefFault, junctionType?: string) =>
  db.collection<GuidanceChunk>('guidance_chunks').aggregate<GuidanceChunk>(guidancePipeline(step, fault, junctionType)).toArray();

/** How long a step that failed is skipped before it's tried again (e.g. after $rerank is switched on). */
export const RETRY_MS = 10 * 60_000;

/** Errors that mean a step isn't available on this cluster (not a passing network problem). */
const UNAVAILABLE = /not enabled|not supported|unrecognized pipeline stage|index .*not found|no such index/i;

/**
 * Tries each step in turn. A step that isn't available is skipped for RETRY_MS; one that failed for a passing
 * reason is tried again next time. Plain vector search is always tried.
 */
export function hybridGuidance(run: typeof runStep = runStep, now = Date.now) {
  const skipUntil = new Map<Step, number>();
  return (db: Db, log: FastifyBaseLogger): FindGuidance =>
    async (fault, junctionType) => {
      let lastErr: unknown;
      for (const step of STEPS) {
        if (step !== 'vector' && (skipUntil.get(step) ?? 0) > now()) continue;
        try {
          return await run(db, step, fault, junctionType);
        } catch (err) {
          lastErr = err;
          log.warn({ err, step }, 'debrief: guidance search step failed, falling back');
          if (UNAVAILABLE.test(String((err as Error)?.message))) skipUntil.set(step, now() + RETRY_MS);
        }
      }
      throw lastErr;
    };
}
