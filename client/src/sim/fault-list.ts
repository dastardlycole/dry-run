import { RULE_NAMES, type Category, type RuleId } from '../faults/types';
import type { DebriefLine } from '../net/debrief';
import type { Vec2 } from '../world/types';

// The list of faults with the examiner's debrief under each (SPEC §4.7 FR-D1–D4), shared by the pause screen
// and the result screen. Rows are drawn at once from the faults the sim found; explanations, citations and
// the examiner's summary fill in as the debrief streams in.

export interface ResultFault {
  /** The fault_events id, which the debrief refers to. */
  id: string;
  ruleId: RuleId;
  category: Category;
  /** Sim seconds from the start of the drive. */
  t: number;
  pos: Vec2;
  /** Where it happened, in words. */
  place: string;
}

/** Below this many tests through a junction, "N of M tests" says more about our data than the junction. */
export const MIN_SESSIONS_FOR_RATE = 3;

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** e.g. "2 of 5 tests here had a fault · 14 reported collisions here since 2020". */
export function junctionLine(j: Extract<DebriefLine, { kind: 'fault' }>['junction']): string {
  if (!j) return '';
  const parts: string[] = [];
  if (j.sessionsThrough >= MIN_SESSIONS_FOR_RATE) {
    parts.push(`${Math.min(j.sessionsWithFault, j.sessionsThrough)} of ${j.sessionsThrough} tests here had a fault`);
  }
  if (j.collisions > 0) {
    const since = j.collisionsSince ? ` since ${new Date(j.collisionsSince).getUTCFullYear()}` : '';
    parts.push(`${j.collisions} reported collision${j.collisions === 1 ? '' : 's'} here${since}`);
  }
  return parts.join(' · ');
}

function citeChips(citations: { title: string; url: string }[]) {
  const cites = el('p', 'cites');
  for (const c of citations) {
    const a = el('a', 'cite', c.title);
    a.href = c.url;
    a.target = '_blank';
    a.rel = 'noopener';
    cites.append(a);
  }
  return cites;
}

export class DebriefView {
  readonly list = el('ol', 'list');
  /** The examiner's summary of the whole test; stays hidden until one arrives. */
  readonly summary = el('div', 'summary');
  /** A short line when the debrief can't be had. */
  readonly note = el('p', 'debrief-note');
  /** Each fault's debrief box, by fault id. */
  private boxes = new Map<string, HTMLElement>();
  /** Faults whose explanation isn't written yet for a passing reason: worth asking again. */
  private notReady = new Set<string>();

  constructor(faults: ResultFault[], emptyText: string) {
    this.summary.hidden = this.note.hidden = true;
    if (faults.length === 0) this.list.append(el('li', 'none', emptyText));
    faults.forEach((f, i) => {
      const li = el('li', f.category);
      li.append(el('span', 'n', String(i + 1)), el('span', 'time', clock(f.t)));
      const what = el('span', 'what');
      what.append(el('b', '', RULE_NAMES[f.ruleId]), document.createTextNode(` · ${f.category} · ${f.place}`));
      const box = el('div', 'debrief');
      box.hidden = true;
      this.boxes.set(f.id, box);
      li.append(what, box);
      this.list.append(li);
    });
  }

  /** The debrief has been asked for: every fault shows that it's on its way. */
  started() {
    for (const box of this.boxes.values()) {
      box.hidden = false;
      box.className = 'debrief waiting';
      box.textContent = 'Examiner is writing…';
    }
  }

  /** A line of the debrief arrived. */
  set(line: DebriefLine) {
    if (line.kind === 'summary') {
      this.summary.replaceChildren(el('h2', '', 'Examiner’s summary'), el('p', 'why', line.text), citeChips(line.citations));
      this.summary.hidden = false;
      return;
    }
    if (line.kind !== 'fault') return;
    const box = this.boxes.get(line.faultId);
    if (!box) return;
    box.hidden = false;
    box.className = 'debrief';
    box.replaceChildren();
    if (line.text) box.append(el('p', 'why', line.text), citeChips(line.citations));
    else if (line.temporary) box.append(el('p', 'why none', 'Not ready yet: the examiner will have it shortly.'));
    else box.append(el('p', 'why none', 'No checked explanation for this one.'));
    if (line.temporary) this.notReady.add(line.faultId);
    else this.notReady.delete(line.faultId);
    const facts = junctionLine(line.junction);
    if (facts) box.append(el('p', 'facts', facts));
  }

  /** Some explanations weren't ready for a passing reason, so asking again may fill them in. */
  get hasNotReady() {
    return this.notReady.size > 0;
  }

  /** The stream is over. `ok` false: it never finished; `unavailable`: the server has no Gemini. */
  ended(ok: boolean, unavailable = false) {
    for (const [id, box] of this.boxes) {
      const waiting = box.classList.contains('waiting');
      // Without Gemini (or without a finished stream) the note below says why; the boxes just go quiet.
      if ((waiting && !ok) || (unavailable && this.notReady.has(id))) {
        box.hidden = true;
        box.replaceChildren();
      } else if (waiting) {
        // The server streamed everything it has, and not this one: it's still on its way from the sim.
        box.className = 'debrief';
        box.replaceChildren(el('p', 'why none', 'Still being sent to the server.'));
      }
    }
    if (!ok || unavailable) {
      this.note.textContent = unavailable
        ? 'The examiner’s debrief needs Gemini, which isn’t set up on the server.'
        : 'Couldn’t get the examiner’s debrief this time.';
      this.note.hidden = false;
    }
  }
}
