import type { FastifyBaseLogger } from 'fastify';
import type { Db } from 'mongodb';
import type { SessionDoc } from '../sessions';
import type { DebriefAI } from './argon';
import { checkExplanation, checkSummary, type Explanation, type GuidanceChunk, type Summary } from './check';
import type { DebriefFault } from './describe';
import type { FindGuidance } from './retrieve';

// Writes the debrief in the background while the learner drives (SPEC §4.7 FR-D2–D5). Each fault is explained
// as soon as it's saved: vector search for guidance → Argon → citation checker → (once more with the checker's
// reasons) → kept, or dropped. Results go in fault_explanations, so the pause screen and the result screen
// only read what's ready. When the test ends, Argon also writes a short summary of the whole test, and the
// finished debrief is saved on the session (SPEC §7).

export interface DebriefDeps {
  findGuidance: (db: Db) => FindGuidance;
  /** null when there's no Gemini key: nothing is written in the background, and the debrief says so. */
  ai: DebriefAI | null;
}

export type FaultDoc = DebriefFault & { sessionId: string };
export type SavedSession = SessionDoc & { debrief?: Explanation[]; summary?: Summary };

/** One fault's explanation, kept once written. `explanation: null` means the checker dropped it twice. */
interface CachedExplanation {
  _id: string;
  sessionId: string;
  explanation: Explanation | null;
  createdAt: Date;
}

export interface FaultResult {
  fault: FaultDoc;
  explanation: Explanation | null;
  /**
   * It failed for a passing reason (network, timeout, index not ready, no Gemini): not kept, so it's tried again
   * later. An explanation is only dropped for good once the checker has turned down TRIES real answers.
   */
  error: boolean;
}

/** Argon calls at once, across all tests: a burst of faults shouldn't hit Gemini's rate limits. */
export const MAX_ACTIVE = 4;
const TRIES = 2;

export const loadFaults = (db: Db, sessionId: string) =>
  db.collection<FaultDoc>('fault_events').find({ sessionId }, { sort: { ts: 1, _id: 1 } }).toArray();

export async function loadChunks(db: Db, ids: string[]): Promise<Map<string, GuidanceChunk>> {
  if (!ids.length) return new Map();
  const found = await db.collection<GuidanceChunk>('guidance_chunks').find({ _id: { $in: ids } }).toArray();
  return new Map(found.map((c) => [c._id, c]));
}

const citedIds = (answer: unknown): string[] => {
  const ids = (answer as { guidanceChunkIds?: unknown } | null)?.guidanceChunkIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
};

export class Debriefer {
  /** Work already under way, so a pause, the end and the background never ask Argon twice for the same thing. */
  private faults = new Map<string, Promise<FaultResult>>();
  private summaries = new Map<string, Promise<Summary | null>>();
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(
    private getDb: () => Promise<Db>,
    private deps: DebriefDeps,
    private log: FastifyBaseLogger,
  ) {}

  get available() {
    return this.deps.ai !== null;
  }

  /** Faults were just saved: start explaining them. Returns at once. */
  faultsSaved(faults: FaultDoc[]) {
    if (!this.available) return;
    for (const f of faults) void this.explain(f);
  }

  /** A test just ended: write its summary and save the debrief. Returns at once. */
  sessionEnded(sessionId: string) {
    if (!this.available) return;
    void this.finish(sessionId);
  }

  /** A fault's explanation: straight from fault_explanations if it's written, else the work in progress, else new work. Never throws. */
  explain(f: FaultDoc): Promise<FaultResult> {
    let p = this.faults.get(f._id);
    if (!p) {
      p = this.explainOnce(f).finally(() => this.faults.delete(f._id));
      this.faults.set(f._id, p);
    }
    return p;
  }

  /**
   * The summary of an ended test, once every fault is explained; saves the debrief and summary on the session
   * (unless something failed for a passing reason). null for a test with no faults, or not ended. Never throws.
   */
  finish(sessionId: string): Promise<Summary | null> {
    let p = this.summaries.get(sessionId);
    if (!p) {
      p = this.finishOnce(sessionId)
        .catch((err) => {
          this.log.warn({ err, sessionId }, 'debrief: summary failed');
          return null;
        })
        .finally(() => this.summaries.delete(sessionId));
      this.summaries.set(sessionId, p);
    }
    return p;
  }

  private async explainOnce(f: FaultDoc): Promise<FaultResult> {
    try {
      const db = await this.getDb();
      const col = db.collection<CachedExplanation>('fault_explanations');
      const cached = await col.findOne({ _id: f._id });
      if (cached) return { fault: f, explanation: cached.explanation, error: false };
      if (!this.deps.ai) return { fault: f, explanation: null, error: true };
      const r = await this.limited(() => this.write(db, f));
      if (!r.error) {
        await col.updateOne(
          { _id: f._id },
          { $setOnInsert: { sessionId: f.sessionId, explanation: r.explanation, createdAt: new Date() } },
          { upsert: true },
        );
      }
      return r;
    } catch (err) {
      this.log.warn({ err, faultId: f._id }, 'debrief: explanation failed');
      return { fault: f, explanation: null, error: true };
    }
  }

  private async write(db: Db, f: FaultDoc): Promise<FaultResult> {
    const ai = this.deps.ai!;
    const found = await this.deps.findGuidance(db)(f);
    if (!found.length) {
      this.log.warn({ faultId: f._id, ruleId: f.ruleId }, 'debrief: no guidance found');
      return { fault: f, explanation: null, error: true };
    }
    const junction = await db
      .collection<{ _id: string; name: string }>('junctions')
      .findOne({ _id: f.junctionId }, { projection: { name: 1 } });
    // `f` was loaded from its own session's fault_events, so it is in the test by construction.
    const faultIds = new Set([f._id]);
    const given = new Set(found.map((c) => c._id));
    let problems: string[] | undefined;
    let rejected = 0;
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      let answer: unknown;
      try {
        answer = await ai.explain({ fault: f, place: junction?.name, chunks: found, problems });
      } catch (err) {
        this.log.warn({ err, faultId: f._id, attempt }, 'debrief: Argon call failed');
        continue;
      }
      const checked = checkExplanation(answer, f, faultIds, given, await loadChunks(db, citedIds(answer)));
      if (checked.ok) return { fault: f, explanation: checked.explanation, error: false };
      rejected++;
      problems = checked.problems;
      this.log.info({ faultId: f._id, attempt, problems }, 'debrief: citation check failed');
    }
    return { fault: f, explanation: null, error: rejected < TRIES };
  }

  private async finishOnce(sessionId: string): Promise<Summary | null> {
    const db = await this.getDb();
    const sessions = db.collection<SavedSession>('sessions');
    const session = await sessions.findOne({ _id: sessionId });
    if (!session?.endedAt || !session.result || !session.counts || session.abandoned) return null;
    // Already finished (with a summary, or with one the checker dropped twice).
    if (session.debrief) return session.summary ?? null;
    const faults = await loadFaults(db, sessionId);
    if (!faults.length || !this.deps.ai) return null;

    const results = await Promise.all(faults.map((f) => this.explain(f)));
    const explained = results.flatMap((r) => (r.explanation ? [r.explanation] : []));
    const cited = [...new Set(explained.flatMap((e) => e.guidanceChunkIds))];
    // Nothing checked to build on (every explanation dropped or failed): no summary rather than an unchecked one.
    if (!cited.length) return null;

    const [chunks, junctions] = await Promise.all([
      loadChunks(db, cited),
      db
        .collection<{ _id: string; name: string }>('junctions')
        .find({ _id: { $in: [...new Set(faults.map((f) => f.junctionId))] } }, { projection: { name: 1 } })
        .toArray(),
    ]);
    const names = new Map(junctions.map((j) => [j._id, j.name]));
    const ruleIds = new Set<string>(faults.map((f) => f.ruleId));
    const given = new Set(chunks.keys());
    const request = {
      result: session.result,
      counts: session.counts,
      faults: results.map((r) => ({ fault: r.fault, place: names.get(r.fault.junctionId), explanation: r.explanation })),
      chunks: [...chunks.values()],
    };

    let summary: Summary | null = null;
    let problems: string[] | undefined;
    let rejected = 0;
    for (let attempt = 1; attempt <= TRIES && !summary; attempt++) {
      let answer: unknown;
      try {
        answer = await this.limited(() => this.deps.ai!.summarise({ ...request, problems }));
      } catch (err) {
        this.log.warn({ err, sessionId, attempt }, 'debrief: Argon summary call failed');
        continue;
      }
      const checked = checkSummary(answer, ruleIds, given, await loadChunks(db, citedIds(answer)));
      if (checked.ok) summary = checked.summary;
      else {
        rejected++;
        problems = checked.problems;
        this.log.info({ sessionId, attempt, problems }, 'debrief: summary citation check failed');
      }
    }
    const error = !summary && rejected < TRIES;

    // Keep it unless something failed for a passing reason, so a reload can try again. Anything the checker
    // dropped twice stays dropped.
    if (!error && !results.some((r) => r.error)) {
      await sessions.updateOne({ _id: sessionId }, { $set: { debrief: explained, ...(summary ? { summary } : {}) } });
    }
    return summary;
  }

  /** Runs `fn` once fewer than MAX_ACTIVE Argon jobs are running. */
  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    // A finished job hands its slot straight to the next one waiting.
    if (this.active >= MAX_ACTIVE) await new Promise<void>((r) => this.queue.push(r));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
