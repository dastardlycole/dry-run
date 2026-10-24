import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { GuidanceChunk } from './check';
import type { DebriefFault } from './describe';
import { guidancePipeline, guidanceQuery, hybridGuidance, RETRY_MS, type Step } from './retrieve';

// The pipelines need Atlas ($rankFusion, $search, $rerank), so here they're only checked for shape; the
// fallback order runs against a fake. `npm run guidance-check -w tools` runs the real thing.

const fault: DebriefFault = {
  _id: 'f1',
  ruleId: 'R5',
  category: 'driving',
  junctionId: 'j1',
  speedMph: 12,
  context: { expected: 'right', action: 'roundabout', exit: 3 },
};
const chunk = (id: string): GuidanceChunk => ({ _id: id, source: 'x', url: 'x', title: id, text: id, ruleIds: ['R5'] });
const fakeLog = () => ({ warn: vi.fn() }) as unknown as FastifyBaseLogger;
const db = {} as Db;

describe('guidancePipeline', () => {
  it('says where it happened, when it knows', () => {
    expect(guidanceQuery({ ...fault, ruleId: 'R1', context: { limitMph: 30 } }, 'crossing')).toMatch(/This happened at a pedestrian crossing\.$/);
    expect(guidanceQuery(fault, 'plain')).not.toMatch(/This happened/);
    // Already says so.
    expect(guidanceQuery(fault, 'roundabout')).toMatch(/3rd exit at a roundabout\.$/);
  });

  it('fuses vector and text search, filtered to the fault rule, then reranks down to 4', () => {
    const p = guidancePipeline('rerank', fault, 'roundabout');
    const fusion = p[0].$rankFusion.input.pipelines;
    expect(fusion.vector[0].$vectorSearch.filter).toEqual({ ruleIds: 'R5' });
    expect(fusion.text[0].$search.compound.filter).toEqual([{ equals: { path: 'ruleIds', value: 'R5' } }]);
    expect(p.map((s) => Object.keys(s)[0])).toEqual(['$rankFusion', '$limit', '$rerank', '$limit', '$project']);
    expect(p[3].$limit).toBe(4);
  });

  it('has the same pipeline as before for plain vector search', () => {
    expect(guidancePipeline('vector', fault).map((s) => Object.keys(s)[0])).toEqual(['$vectorSearch', '$project']);
  });
});

describe('hybridGuidance', () => {
  it('uses the best step that works, and skips a broken one until it is worth trying again', async () => {
    let t = 0;
    const tried: Step[] = [];
    const run = vi.fn(async (_db: Db, step: Step) => {
      tried.push(step);
      if (step === 'rerank') throw new Error('$rerank is not enabled for dry-run');
      return [chunk(step)];
    });
    const log = fakeLog();
    const find = hybridGuidance(run, () => t)(db, log);

    expect((await find(fault))[0]._id).toBe('hybrid');
    expect(tried).toEqual(['rerank', 'hybrid']);
    expect(log.warn).toHaveBeenCalledTimes(1);

    tried.length = 0;
    await find(fault);
    expect(tried).toEqual(['hybrid']);

    t += RETRY_MS + 1;
    tried.length = 0;
    await find(fault);
    expect(tried).toEqual(['rerank', 'hybrid']);
  });

  it('tries a step again next time if it failed for a passing reason', async () => {
    const tried: Step[] = [];
    let blip = true;
    const find = hybridGuidance(async (_db, step) => {
      tried.push(step);
      if (step === 'rerank' && blip) {
        blip = false;
        throw new Error('connection timed out');
      }
      return [chunk(step)];
    })(db, fakeLog());
    expect((await find(fault))[0]._id).toBe('hybrid');
    expect((await find(fault))[0]._id).toBe('rerank');
    expect(tried).toEqual(['rerank', 'hybrid', 'rerank']);
  });

  it('falls back to plain vector search, and throws only if that fails too', async () => {
    const onlyVector = hybridGuidance(async (_db, step) => {
      if (step !== 'vector') throw new Error('no');
      return [chunk('v')];
    })(db, fakeLog());
    expect((await onlyVector(fault))[0]._id).toBe('v');

    const none = hybridGuidance(async () => {
      throw new Error('Atlas down');
    })(db, fakeLog());
    await expect(none(fault)).rejects.toThrow('Atlas down');
  });
});
