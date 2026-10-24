import { speechSeconds } from './director';
import { sentencesOf } from './phrases';

// The examiner's voice (SPEC §4.5 FR-E1): pre-made Gemini TTS audio from /audio (tools/src/gen-tts.ts, every
// sentence in phrases.ts everyPhrase),
// or the browser's own speech when a sentence has no file. Nothing here ever makes driving wait:
// `say` returns at once and sentences play one after another in the background. `sayAudio` plays audio made
// on the fly instead (the examiner's summary, from the server).

/** A sentence to say, with its own audio when it isn't one of the cached files. */
interface Line {
  text: string;
  audio?: ArrayBuffer;
  /** Shown as a caption (short directions); a long summary already on screen isn't. */
  caption: boolean;
}

/** /audio/manifest.json: sentence → file name in /audio. */
export type AudioManifest = Record<string, string>;

export class Voice {
  private ctx: AudioContext | null = null;
  private manifest: AudioManifest = {};
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private queue: Line[] = [];
  private busy = false;
  /** Bumped by stop(), so a sentence still loading when the car is reset doesn't play afterwards. */
  private generation = 0;
  /** Called when a sentence starts, e.g. to show it as a caption. */
  onSpeak: (text: string) => void = () => {};

  constructor(private base = '/audio') {
    fetch(`${base}/manifest.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((m: AudioManifest) => {
        this.manifest = m;
        // Fetch and decode everything up front, so playback doesn't wait on the network.
        for (const text of Object.keys(m)) this.buffer(text);
      })
      .catch(() => console.warn('[voice] no audio manifest; using the browser voice'));
    // Browsers only allow sound after the user has done something, so unlock on the first key or click.
    const unlock = () => {
      this.audio()?.resume();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  say(text: string) {
    this.queue.push({ text, caption: true });
    if (!this.busy) this.playNext();
  }

  /**
   * Says `text` using this audio (any format the browser decodes), or the browser's voice if it won't decode.
   * No caption: it's for text that's already on screen.
   */
  sayAudio(text: string, audio: ArrayBuffer) {
    this.queue.push({ text, audio, caption: false });
    if (!this.busy) this.playNext();
  }

  /** The browser's voice only, with no caption: for text that's already on screen and has no audio. */
  sayUncaptioned(text: string) {
    this.queue.push({ text, caption: false });
    if (!this.busy) this.playNext();
  }

  /** Stop talking and forget anything queued (e.g. on reset). */
  stop() {
    this.queue = [];
    this.generation++;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.current?.stop();
    this.current = null;
    this.busy = false;
  }

  private current: AudioBufferSourceNode | null = null;

  private audio(): AudioContext | null {
    if (!this.ctx && typeof AudioContext !== 'undefined') this.ctx = new AudioContext();
    return this.ctx;
  }

  private buffer(text: string): Promise<AudioBuffer | null> {
    let b = this.buffers.get(text);
    if (!b) {
      const file = this.manifest[text];
      const ctx = this.audio();
      b =
        file && ctx
          ? fetch(`${this.base}/${file}`)
              .then((r) => r.arrayBuffer())
              .then((data) => ctx.decodeAudioData(data))
              .catch((err) => {
                console.warn(`[voice] couldn't load ${file}`, err);
                return null;
              })
          : Promise.resolve(null);
      this.buffers.set(text, b);
    }
    return b;
  }

  private async playNext(): Promise<void> {
    const line = this.queue.shift();
    if (line === undefined) {
      this.busy = false;
      return;
    }
    const { text, audio, caption } = line;
    this.busy = true;
    // A joined direction ("… Then at the roundabout, …") has a file per sentence: play them back to back.
    const parts = sentencesOf(text);
    if (!audio && !this.manifest[text] && parts.length > 1 && parts.every((p) => this.manifest[p])) {
      if (caption) this.onSpeak(text);
      this.queue.unshift(...parts.map((p) => ({ text: p, caption: false })));
      return this.playNext();
    }
    const gen = this.generation;
    const done = () => {
      if (gen === this.generation) this.playNext();
    };
    const ctx = this.audio();
    let buf: AudioBuffer | null = null;
    if ((audio || this.manifest[text]) && ctx) {
      if (ctx.state !== 'running') await withTimeout(ctx.resume(), 300);
      if (ctx.state === 'running') {
        // Only use the file if it's already decoded or about to be: a slow download falls back to speech.
        buf = audio
          ? await withTimeout(ctx.decodeAudioData(audio).catch(() => null), 1000)
          : await withTimeout(this.buffer(text), 300);
      }
    }
    if (gen !== this.generation) return;
    if (caption) this.onSpeak(text);
    if (buf && ctx) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => {
        if (this.current === src) this.current = null;
        done();
      };
      this.current = src;
      src.start();
    } else {
      speak(text, done);
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Kept so Chrome doesn't garbage-collect the utterance mid-sentence and never fire its end event. */
let speaking: SpeechSynthesisUtterance | null = null;

/** The browser's built-in speech, in a British voice if there is one. */
function speak(text: string, done: () => void) {
  if (typeof speechSynthesis === 'undefined') return done();
  // Calls `done` once: when speech ends, or after a generous guess at its length if the end event never
  // comes (a known Chrome bug), so the queue can't get stuck and silence every later direction.
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (speaking === u) speaking = null;
    done();
  };
  const timer = setTimeout(finish, speechSeconds(text) * 1000 * 2 + 2000);
  const u = new SpeechSynthesisUtterance(text);
  speaking = u;
  u.lang = 'en-GB';
  const voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-GB');
  if (voice) u.voice = voice;
  u.rate = 0.95;
  u.onend = finish;
  u.onerror = finish;
  speechSynthesis.speak(u);
}
