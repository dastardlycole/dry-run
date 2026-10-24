// The start card (SPEC §16, row 22): "Where's your driving test?". The learner types a test centre or a
// postcode; the server finds the DVSA centre and, the first time, builds its map and routes (about a
// minute), and the page reloads on that centre. Wanstead drives behind the card meanwhile, so nothing waits.

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

export class CentrePicker {
  private el = document.querySelector<HTMLDivElement>('#centre')!;
  private input: HTMLInputElement;
  private note: HTMLParagraphElement;
  private findButton: HTMLButtonElement;
  private bar: HTMLDivElement;

  constructor(currentName: string) {
    this.el.innerHTML = `
      <form class="card">
        <h1>Where's your driving test?</h1>
        <p>Type your test centre or postcode. You'll drive real test-style routes on the roads around it.</p>
        <div class="row">
          <input name="q" autocomplete="postal-code" placeholder="e.g. Goodmayes or IG3 9UZ" maxlength="100" />
          <button type="submit" class="primary">Find</button>
        </div>
        <div class="bar" hidden><div></div></div>
        <p class="note" aria-live="polite"></p>
        <button type="button" class="link">Just drive ${escape(currentName)}</button>
      </form>`;
    const form = this.el.querySelector('form')!;
    this.input = form.querySelector('input')!;
    this.note = form.querySelector('.note')!;
    this.findButton = form.querySelector('button[type=submit]')!;
    this.bar = form.querySelector('.bar')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.find(this.input.value);
    });
    form.querySelector('.link')!.addEventListener('click', () => this.hide());
    // Typing here isn't driving: keep the keys from the game (driving, T for 'tell me', starting the test).
    for (const type of ['keydown', 'keyup', 'pointerdown'] as const) this.el.addEventListener(type, (e) => e.stopPropagation());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
  }

  show() {
    this.el.hidden = false;
    document.body.classList.add('choosing');
    this.input.focus();
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
    location.search = `?centre=${encodeURIComponent(id)}`;
  }
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
