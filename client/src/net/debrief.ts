// Reads the debrief stream from GET /api/sessions/:id/debrief (SPEC §4.7 FR-D2–D5): one JSON line per saved
// fault as it's ready (the server writes them in the background while you drive), the examiner's summary once
// the test has ended, then a `done` line. Used by the pause screen mid-drive and the result screen at the end;
// retried a few times if the connection drops.

export interface Citation {
  id: string;
  title: string;
  url: string;
}

/** "N of M tests had a fault here" and STATS19 collisions at the fault's junction. */
export interface JunctionFacts {
  name: string;
  sessionsThrough: number;
  /** How many of those are seeded demo tests, not real drives. */
  simulatedThrough: number;
  sessionsWithFault: number;
  collisions: number;
  /** ISO date of the earliest collision counted. */
  collisionsSince: string | null;
}

export type DebriefLine =
  /**
   * `text` is null when there's no checked explanation: dropped by the citation checker, or (`temporary`) not
   * written yet for a passing reason, so asking again later may get it.
   */
  | { kind: 'fault'; faultId: string; junction: JunctionFacts | null; text: string | null; citations: Citation[]; temporary: boolean }
  /** The examiner's summary of the whole test (ended tests only). */
  | { kind: 'summary'; text: string; citations: Citation[] }
  | { kind: 'done'; unavailable: boolean };

export const TRIES = 4;
export const RETRY_MS = 1500;

/** Splits text that arrives in pieces into whole lines; the last, unfinished part is kept for next time. */
export class LineSplitter {
  private rest = '';

  push(piece: string): string[] {
    const parts = (this.rest + piece).split('\n');
    this.rest = parts.pop()!;
    return parts.filter((l) => l.trim());
  }

  /** Whatever is left once the stream has ended. */
  end(): string[] {
    const last = this.rest.trim();
    this.rest = '';
    return last ? [last] : [];
  }
}

/**
 * Streams the debrief into `onLine`. Resolves true once the `done` line arrives, false if it gives up
 * (the caller shows a short note). Lines already seen aren't sent again on a retry.
 */
export async function streamDebrief(
  sessionId: string,
  onLine: (line: DebriefLine) => void,
  signal?: AbortSignal,
  send: typeof fetch = (...a) => fetch(...a),
): Promise<boolean> {
  const seen = new Set<string>();
  for (let attempt = 1; attempt <= TRIES && !signal?.aborted; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, RETRY_MS));
    try {
      const res = await send(`/api/sessions/${encodeURIComponent(sessionId)}/debrief`, { signal });
      if (res.status === 404) return false;
      if (!res.ok || !res.body) continue;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const split = new LineSplitter();
      const take = (lines: string[]) => {
        for (const raw of lines) {
          const line = JSON.parse(raw) as DebriefLine;
          if (line.kind === 'fault') {
            if (seen.has(line.faultId)) continue;
            seen.add(line.faultId);
          }
          onLine(line);
          if (line.kind === 'done') return true;
        }
        return false;
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (take(split.push(value))) return true;
      }
      if (take(split.end())) return true;
    } catch (err) {
      if (signal?.aborted) return false;
      console.warn('[debrief] stream failed; trying again', err);
    }
  }
  return false;
}
