import { RULE_NAMES, type Category, type RuleId } from '../faults/types';
import { streamDebrief, type Citation } from '../net/debrief';
import { el } from './fault-list';

// The examiner's notes, top right while you drive: the latest fault at once, then the examiner's explanation of
// it (the same text the pause and result screens show) as soon as the server has written it. Only the latest
// note shows, and it fades after a while. Driving never waits for it: without an explanation it just shows the fault.

/** How long a note stays once its explanation is in, or once it's clear none is coming. */
const EXPLAINED_MS = 15_000;
/** How long a note waits for its explanation before fading anyway (and the wait for it stops). */
const WAITING_MS = 30_000;
/** Explanations that weren't written yet for a passing reason are asked for once more, this long after. */
const RETRY_MS = 5000;

export interface Explanation {
  text: string;
  citations: Citation[];
}

/**
 * One fault's explanation from the debrief stream: stops reading as soon as its line arrives. null if there's
 * none (no Gemini, dropped by the citation checker, never saved, or still not written after `tries`).
 */
export async function fetchExplanation(
  sessionId: string,
  faultId: string,
  signal: AbortSignal,
  { stream = streamDebrief, tries = 2, retryMs = RETRY_MS }: { stream?: typeof streamDebrief; tries?: number; retryMs?: number } = {},
): Promise<Explanation | null> {
  for (let attempt = 1; attempt <= tries && !signal.aborted; attempt++) {
    if (attempt > 1) await pause(retryMs, signal);
    if (signal.aborted) return null;
    // Stops this read once the line is in, or when the caller gives up.
    const stop = new AbortController();
    const giveUp = () => stop.abort();
    signal.addEventListener('abort', giveUp);
    let found: Explanation | null = null;
    let again = false;
    try {
      await stream(
        sessionId,
        (line) => {
          if (line.kind !== 'fault' || line.faultId !== faultId) return;
          if (line.text) found = { text: line.text, citations: line.citations };
          again = line.temporary;
          stop.abort();
        },
        stop.signal,
      );
    } finally {
      signal.removeEventListener('abort', giveUp);
    }
    if (found || !again) return found;
  }
  return null;
}

/** Waits `ms`, or less if the caller gives up first. */
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((done) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      done();
    }
  });
}

export class ExaminerPanel {
  private box = document.getElementById('examiner')!;
  private fadeTimer = 0;
  /** The fault the note is about; a late explanation for an older one is ignored. */
  private faultId: string | null = null;
  /** Stops the wait for this note's explanation once the note has gone. */
  private abort: AbortController | null = null;

  /**
   * A fault was just marked: its name and place now, the explanation once `explain` is called. The signal says
   * when to stop waiting for it (the note faded or was replaced).
   */
  show(faultId: string, ruleId: RuleId, category: Category, place: string): AbortSignal {
    this.abort?.abort();
    this.abort = new AbortController();
    this.faultId = faultId;
    const what = el('p', `what ${category}`);
    what.append(el('b', '', RULE_NAMES[ruleId]), document.createTextNode(` · ${category}`));
    this.box.replaceChildren(
      el('h2', '', 'Examiner’s notes'),
      what,
      el('p', 'where', place),
      el('p', 'why waiting', 'Examiner is writing…'),
      el('p', 'more', 'Esc for all notes'),
    );
    this.box.hidden = false;
    this.box.classList.remove('fading');
    this.fadeAfter(WAITING_MS);
    return this.abort.signal;
  }

  /** The explanation for `faultId` arrived (null: none is coming). Ignored if a newer fault is showing. */
  explain(faultId: string, explanation: Explanation | null) {
    if (faultId !== this.faultId || this.box.hidden) return;
    // It may have come in as the note began to fade.
    this.box.classList.remove('fading');
    const why = this.box.querySelector('.why')!;
    if (explanation) {
      const cites = el('p', 'cites');
      for (const c of explanation.citations) cites.append(el('span', 'cite', c.title));
      why.replaceWith(el('p', 'why', explanation.text), cites);
    } else {
      why.remove();
    }
    this.fadeAfter(EXPLAINED_MS);
  }

  hide() {
    clearTimeout(this.fadeTimer);
    this.abort?.abort();
    this.abort = null;
    this.faultId = null;
    this.box.hidden = true;
  }

  private fadeAfter(ms: number) {
    clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.box.classList.add('fading');
      // Matches the fade in style.css.
      this.fadeTimer = window.setTimeout(() => this.hide(), 1000);
    }, ms);
  }
}
