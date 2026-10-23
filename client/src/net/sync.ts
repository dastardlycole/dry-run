import type { Counts, Result } from '../faults/result';
import type { FaultEvent } from '../faults/types';

// Sends sessions and faults to the server in the background (SPEC §4.6, §9 API). Driving never waits
// for it: calls go into a queue that's sent in order once a second, and anything that fails stays
// queued and is tried again. Every call is safe to repeat, so a retry after a lost reply is fine.

export interface SessionStart {
  sessionId: string;
  learnerId: string;
  centreId: string;
  routeId: string;
  /** ISO time. */
  startedAt: string;
}

export interface Saved {
  sessionId: string;
  result: Result;
  counts: Counts;
}

type Job =
  | { kind: 'start'; body: SessionStart }
  | { kind: 'events'; events: FaultEvent[] }
  | { kind: 'end'; sessionId: string; endedAt: string };

export const SEND_EVERY_MS = 1000;
/** The server takes up to 500 per batch. */
const BATCH = 500;
/** Worth trying again: the server is down or busy, or it hasn't seen the session yet. */
const RETRY = new Set([408, 409, 429]);

export type SyncState = 'idle' | 'sending' | 'offline';

export class Sync {
  private jobs: Job[] = [];
  private faults: FaultEvent[] = [];
  /** Sessions the server refused to start: anything more for them is ignored. */
  private dropped = new Set<string>();
  private busy = false;
  private timer = 0;
  state: SyncState = 'idle';
  /** A session's end was saved; the result is the server's own count. */
  onSaved?: (saved: Saved) => void;
  onState?: (state: SyncState) => void;
  /** The server refused a session's start or end, so it won't be saved (or not fully). */
  onFailed?: (sessionId: string) => void;

  constructor(private send: typeof fetch = (...a) => fetch(...a)) {}

  /** Starts sending once a second. */
  start() {
    this.timer = window.setInterval(() => void this.flush(), SEND_EVERY_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  startSession(body: SessionStart) {
    this.jobs.push({ kind: 'start', body });
  }

  addFault(event: FaultEvent) {
    if (!this.dropped.has(event.sessionId)) this.faults.push(event);
  }

  endSession(sessionId: string, endedAt: string) {
    if (this.dropped.has(sessionId)) return;
    this.batchFaults();
    this.jobs.push({ kind: 'end', sessionId, endedAt });
  }

  /** True while anything for `sessionId` is still waiting to be sent. */
  pendingFor(sessionId: string): boolean {
    return (
      this.faults.some((e) => e.sessionId === sessionId) ||
      this.jobs.some((j) =>
        j.kind === 'start' ? j.body.sessionId === sessionId : j.kind === 'end' ? j.sessionId === sessionId : j.events.some((e) => e.sessionId === sessionId),
      )
    );
  }

  /** Sends what's queued, in order, stopping at the first call that should be tried again. */
  async flush() {
    if (this.busy) return;
    this.busy = true;
    this.batchFaults();
    try {
      while (this.jobs.length) {
        if (this.state !== 'offline') this.setState('sending');
        const job = this.jobs[0];
        const res = await this.post(job).catch(() => null);
        if (!res || res.status >= 500 || RETRY.has(res.status)) {
          this.setState('offline');
          return;
        }
        this.jobs.shift();
        if (!res.ok) {
          console.error(`[sync] server refused ${job.kind} (${res.status}); dropped`, job, await res.text().catch(() => ''));
          if (job.kind === 'start') this.dropSession(job.body.sessionId);
          else if (job.kind === 'end') this.onFailed?.(job.sessionId);
        } else if (job.kind === 'end') {
          const saved = await res.json().catch(() => null);
          if (saved) this.onSaved?.(saved);
          else this.onFailed?.(job.sessionId);
        }
      }
      this.setState('idle');
    } finally {
      this.busy = false;
    }
  }

  /** Without its session the server would refuse the rest as unknown, holding up the queue for good. */
  private dropSession(sessionId: string) {
    this.dropped.add(sessionId);
    this.faults = this.faults.filter((e) => e.sessionId !== sessionId);
    this.jobs = this.jobs.flatMap((j): Job[] => {
      if (j.kind === 'start') return j.body.sessionId === sessionId ? [] : [j];
      if (j.kind === 'end') return j.sessionId === sessionId ? [] : [j];
      const events = j.events.filter((e) => e.sessionId !== sessionId);
      return events.length ? [{ kind: 'events', events }] : [];
    });
    this.onFailed?.(sessionId);
  }

  private batchFaults() {
    while (this.faults.length) this.jobs.push({ kind: 'events', events: this.faults.splice(0, BATCH) });
  }

  private post(job: Job) {
    const [url, body] =
      job.kind === 'start'
        ? ['/api/sessions', job.body]
        : job.kind === 'events'
          ? ['/api/events', { events: job.events }]
          : [`/api/sessions/${encodeURIComponent(job.sessionId)}/end`, { endedAt: job.endedAt }];
    return this.send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  private setState(s: SyncState) {
    if (s === this.state) return;
    this.state = s;
    this.onState?.(s);
  }
}
