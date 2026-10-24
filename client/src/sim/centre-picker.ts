// The start card (SPEC §16, row 22): "Where's your driving test?". The learner types a test centre or a
// postcode; the server finds the DVSA centre and, the first time, builds its map and routes (about a
// minute), and the page reloads on that centre. Wanstead drives behind the card meanwhile, so nothing waits.
// Below that, the routes at the centre on screen (row 15, mock test): pick one, or "Surprise me" for a random one.
// A switch above them picks a mock test or a practice drive (row 17), where an instructor gives a tip at each
// fault; "Free drive" is practice with no route.

import { loadRoute } from '../world/furniture';
import { routeSummary } from '../world/route-summary';

interface Progress {
  step: number;
  of: number;
  label: string;
}

interface Found {
  centre: { id: string; name: string; address: string; postcode: string };
  status: 'ready' | 'building' | 'failed';
  progress?: Progress;
  error?: string;
}

const POLL_MS = 2000;
/** A build that isn't done after this long has gone wrong somewhere. */
const GIVE_UP_MS = 5 * 60_000;

/** Where a centre's files are and which routes it has; for one the server built, ask it. */
export async function centreFiles(id: string): Promise<{ base: string; routes: string[] }> {
  try {
    const res = await fetch(`/api/centres/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(5000) });
    const s = await res.json();
    if (s.status === 'ready') return { base: s.base, routes: s.routes };
  } catch (err) {
    console.warn('[centre] status not available, trying the shipped files', err);
  }
  return { base: `/${id}`, routes: [] };
}

/** Mock test (the default), practice on a route, or practice with no route (free drive). In the link as ?mode=. */
export type Mode = 'test' | 'practice' | 'free';

export const modeOf = (param: string | null): Mode => (param === 'practice' || param === 'free' ? param : 'test');

const ABOUT: Record<'test' | 'practice', string> = {
  test: "A mock test: the examiner only gives directions, and the pass mark is scaled to the route's length.",
  practice: 'Practice: an instructor gives you a tip the moment something needs work, and there is no pass or fail. Press J to repeat the last junction.',
};

/** The centre on screen behind the card and its routes. */
export interface Here {
  id: string;
  name: string;
  /** Where its files are (see centreFiles). */
  base: string;
  routeIds: string[];
  /** The route loaded now. */
  routeId: string;
  /** It was picked (?centre=), so its routes come first on the card. */
  picked: boolean;
  /** The drive behind the card now. */
  mode: Mode;
}

export class CentrePicker {
  private el = document.querySelector<HTMLDivElement>('#centre')!;
  private input: HTMLInputElement;
  private note: HTMLParagraphElement;
  private findButton: HTMLButtonElement;
  private bar: HTMLDivElement;

  /** Routes whose file didn't load: not offered. */
  private broken = new Set<string>();
  /** What a route picked on the card starts: a mock test or a practice drive. */
  private kind: 'test' | 'practice';

  constructor(private here: Here) {
    const find = `
      <form class="find">
        <h${here.picked ? 2 : 1}>${here.picked ? 'Somewhere else?' : "Where's your driving test?"}</h${here.picked ? 2 : 1}>
        <p>Type your test centre or postcode. You'll drive real test-style routes on the roads around it.</p>
        <div class="row">
          <input name="q" autocomplete="postal-code" placeholder="e.g. Goodmayes or IG3 9UZ" maxlength="100" />
          <button type="submit" class="primary">Find</button>
        </div>
        <div class="bar" hidden><div></div></div>
        <p class="note" aria-live="polite"></p>
      </form>`;
    const routes = `
      <section class="routes">
        <h${here.picked ? 1 : 2} class="centre-name"></h${here.picked ? 1 : 2}>
        <div class="modes" role="radiogroup" aria-label="Kind of drive">
          <button type="button" role="radio" data-mode="test">Mock test</button>
          <button type="button" role="radio" data-mode="practice">Practise</button>
        </div>
        <p class="about"></p>
        <ul></ul>
        <div class="row">
          <button type="button" class="primary surprise">Surprise me</button>
          <button type="button" class="link free">Free drive</button>
        </div>
      </section>`;
    this.el.innerHTML = `<div class="card">${here.picked ? routes + find : find + routes}</div>`;
    const form = this.el.querySelector('form')!;
    this.input = form.querySelector('input')!;
    this.note = form.querySelector('.note')!;
    this.findButton = form.querySelector('button[type=submit]')!;
    this.bar = form.querySelector('.bar')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.find(this.input.value);
    });
    this.kind = here.mode === 'test' ? 'test' : 'practice';
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.modes button')) {
      b.addEventListener('click', () => this.pick(b.dataset.mode as 'test' | 'practice'));
    }
    this.pick(this.kind);
    // Practice with no route: coaching on whatever roads the learner likes.
    this.el.querySelector('.free')!.addEventListener('click', () => {
      if (here.mode === 'free') return this.hide();
      location.search = `?centre=${encodeURIComponent(here.id)}&mode=free`;
    });
    this.el.querySelector('.surprise')!.addEventListener('click', () => {
      const ids = here.routeIds.filter((id) => !this.broken.has(id));
      if (ids.length) this.choose(ids[Math.floor(Math.random() * ids.length)]);
    });
    // No route list (the server didn't answer): no routes part, the drive behind the card still works.
    (this.el.querySelector('.routes') as HTMLElement).hidden = !here.routeIds.length;
    this.listRoutes(this.el.querySelector('ul')!);
    this.named(here.name);
    // Typing here isn't driving: keep the keys from the game (driving, T for 'tell me', starting the test).
    for (const type of ['keydown', 'keyup', 'pointerdown'] as const) this.el.addEventListener(type, (e) => e.stopPropagation());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
  }

  /** Mock test or practice, for the routes below the switch. */
  private pick(kind: 'test' | 'practice') {
    this.kind = kind;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.modes button')) {
      b.setAttribute('aria-checked', String(b.dataset.mode === kind));
    }
    this.el.querySelector('.about')!.textContent = ABOUT[kind];
  }

  /** The centre's name in the routes heading. */
  named(name: string) {
    this.el.querySelector('.centre-name')!.textContent = this.here.picked ? `${name}: pick a route` : `Or practise at ${name}`;
  }

  show() {
    this.el.hidden = false;
    document.body.classList.add('choosing');
    // With the routes first, focusing the box further down would scroll them out of sight.
    if (!this.here.picked) this.input.focus();
  }

  /** Called when the card closes, e.g. to forget keys pressed while it was open. */
  onHide: () => void = () => {};

  hide() {
    this.el.hidden = true;
    document.body.classList.remove('choosing');
    this.onHide();
    this.input.blur();
  }

  get visible() {
    return !this.el.hidden;
  }

  /** One button per route, filled in as each route's file comes in (they're small). */
  private listRoutes(list: HTMLUListElement) {
    for (const id of this.here.routeIds) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<b>${escape(id)}</b><span>…</span>`;
      button.addEventListener('click', () => this.choose(id));
      li.append(button);
      list.append(li);
      loadRoute(this.here.base, id)
        .then((r) => {
          button.querySelector('b')!.textContent = r.name;
          button.querySelector('span')!.textContent = routeSummary(r);
        })
        .catch(() => {
          this.broken.add(id);
          button.disabled = true;
          button.querySelector('span')!.textContent = 'not available';
        });
    }
  }

  /** Drive route `id`: it's already loaded if it's the one behind the card (as the same kind of drive), else load the page on it. */
  private choose(id: string) {
    if (id === this.here.routeId && this.kind === this.here.mode) return this.hide();
    const mode = this.kind === 'practice' ? '&mode=practice' : '';
    location.search = `?centre=${encodeURIComponent(this.here.id)}&route=${encodeURIComponent(id)}${mode}`;
  }

  private say(text: string, error = false) {
    this.note.textContent = text;
    this.note.classList.toggle('error', error);
  }

  private async find(q: string) {
    if (!q.trim()) return;
    this.findButton.disabled = true;
    this.say('Looking it up…');
    try {
      const res = await fetch('/api/centres/find', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json();
      if (!res.ok) return this.say(body.error ?? 'Sorry, something went wrong. Try again.', true);
      await this.waitFor(body as Found);
    } catch (err) {
      console.warn('[centre] lookup failed', err);
      this.say("Can't reach the server just now. Try again in a moment.", true);
    } finally {
      this.findButton.disabled = false;
    }
  }

  /** Fills the bar to `fraction` (0–1), or hides it. */
  private fill(fraction: number | null) {
    this.bar.hidden = fraction === null;
    (this.bar.firstElementChild as HTMLDivElement).style.width = `${Math.round((fraction ?? 0) * 100)}%`;
  }

  private async waitFor(found: Found) {
    const { id, name, address, postcode } = found.centre;
    const started = Date.now();
    let s: Found | { status: Found['status']; progress?: Progress; error?: string } = found;
    while (s.status === 'building' && Date.now() - started < GIVE_UP_MS) {
      // Halfway through the stage it's at, so the bar moves on as each stage starts and never sits at 0.
      const p = s.progress;
      this.fill(p ? (p.step - 0.5) / p.of : 0.05);
      const secs = Math.round((Date.now() - started) / 1000);
      this.say(`Found ${name} test centre (${address}, ${postcode}). ${p?.label ?? 'Getting ready'}… ${secs} s (about a minute the first time).`);
      await new Promise((r) => setTimeout(r, POLL_MS));
      s = await fetch(`/api/centres/${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => s);
    }
    if (s.status !== 'ready') {
      this.fill(null);
      // 'failed' has its own message; anything else (a restarted server forgets builds) gets this one.
      const msg = s.status === 'failed' && s.error ? s.error : 'Sorry, the map for this centre could not be built. Try again.';
      return this.say(msg, true);
    }
    this.fill(1);
    this.say(`${name} is ready. Loading…`);
    // The kind of drive picked on the switch carries over to the new centre.
    location.search = `?centre=${encodeURIComponent(id)}${this.kind === 'practice' ? '&mode=practice' : ''}`;
  }
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
