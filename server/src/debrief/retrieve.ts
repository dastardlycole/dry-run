import type { Db } from 'mongodb';
import type { GuidanceChunk } from './check';
import { describeFault, type DebriefFault } from './describe';

// RAG retrieval (SPEC §4.7 FR-D2, §8): $vectorSearch over guidance_chunks, whose `text` Atlas embeds itself
// (Automated Embedding, Voyage). Only chunks tagged with the fault's rule can come back.

export const GUIDANCE_INDEX = 'guidance_vector';
export const GUIDANCE_LIMIT = 4;

export type FindGuidance = (fault: DebriefFault) => Promise<GuidanceChunk[]>;

export const vectorGuidance =
  (db: Db): FindGuidance =>
  (fault) =>
    db
      .collection<GuidanceChunk>('guidance_chunks')
      .aggregate<GuidanceChunk>([
        {
          $vectorSearch: {
            index: GUIDANCE_INDEX,
            path: 'text',
            query: { text: `How to avoid this fault on the UK driving test. ${describeFault(fault)}` },
            filter: { ruleIds: fault.ruleId },
            numCandidates: 50,
            limit: GUIDANCE_LIMIT,
          },
        },
        { $project: { source: 1, url: 1, title: 1, text: 1, ruleIds: 1 } },
      ])
      .toArray();
