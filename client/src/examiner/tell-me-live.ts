import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { downsample, floatToPcm16Base64, MIC_RATE, pcm16Base64ToFloat, SPEAKER_RATE } from './pcm';
import { TellMeCard, type CardExtras } from './tell-me-card';
import {
  isBusy,
  offered,
  outcome,
  parseVerdict,
  step,
  TOOL_NAME,
  type FlowEvent,
  type FlowState,
  type LiveTicket,
  type TellMeAnswer,
} from './tell-me';

// The 'tell me' question in the browser (SPEC §4.5 FR-E3): the card, the keys, the microphone, the examiner's
// voice and the Gemini Live session, driven by the steps in tell-me.ts. Any failure (no microphone, no token,
// Live closing) skips the question, and the drive starts as normal.

const TOKEN_TIMEOUT_MS = 5000;
/** Mic audio is sent in pieces about this long. */
const SEND_EVERY_S = 0.1;
/** Keys that drive the car: pressing one means the learner would rather just go. */
const DRIVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Escape']);
const TICK_MS = 250;

export class TellMe {
  private state: FlowState = offered(performance.now());
  private extras: CardExtras = { heard: '', said: '' };
  private live: LiveRun | null = null;
  /** The question is over: the answer, or null if it was skipped. */
  onSettled: (answer: TellMeAnswer | null) => void = () => {};

  constructor(private card = new TellMeCard()) {
    window.addEventListener('keydown', (e) => {
      if (!this.busy) return;
      if (e.code === 'KeyT') {
        if (e.repeat) return;
        const p = this.state.phase;
        this.dispatch(p === 'offered' ? { type: 'start' } : p === 'verdict' ? { type: 'dismiss' } : { type: 'pressT' });
      } else if (DRIVE_KEYS.has(e.code)) this.dispatch({ type: 'skip', why: `${e.code} pressed` });
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyT') this.dispatch({ type: 'releaseT' });
    });
    window.addEventListener('blur', () => this.dispatch({ type: 'releaseT' }));
    setInterval(() => this.dispatch({ type: 'tick' }), TICK_MS);
    this.card.render(this.state, this.extras);
  }

  /** True until the question has been answered or skipped. The drive doesn't start before then. */
  get busy() {
    return isBusy(this.state);
  }

  /** Offers the question again (a new test after R), dropping any session still open. */
  offer() {
    this.close();
    this.extras = { heard: '', said: '' };
    this.state = offered(performance.now());
    this.card.render(this.state, this.extras);
  }

  private dispatch(e: FlowEvent) {
    const prev = this.state;
    this.state = step(prev, e, performance.now());
    if (this.state === prev) return;
    const s = this.state;
    if (s.phase === 'listening') {
      this.extras.heard = '';
      this.live?.startTurn();
    } else if (prev.phase === 'listening') this.live?.endTurn();
    if (s.phase === 'connecting') void this.connect();
    if (!isBusy(s)) {
      if (s.phase === 'skipped') console.info(`[tell-me] skipped: ${s.why}`);
      // After a verdict the examiner may still be saying it: let that finish.
      this.close(s.phase === 'done');
      this.onSettled(outcome(s));
    }
    this.card.render(s, this.extras);
  }

  private async connect() {
    // Made here, still inside the T key press, so the browser lets them make sound and hear the mic.
    const run = new LiveRun({
      onText: (who, text) => {
        if (who === 'learner') this.extras.heard += text;
        else this.extras.said = text;
        this.card.render(this.state, this.extras);
      },
      onVerdict: (args) => {
        const verdict = parseVerdict(args);
        if (verdict) this.dispatch({ type: 'verdict', verdict });
        else console.warn('[tell-me] not a verdict:', args);
      },
      onEnd: (why) => {
        if (this.live === run) this.dispatch({ type: 'skip', why });
      },
    });
    this.live = run;
    try {
      const ticket = await run.open();
      if (this.live !== run) return;
      this.extras.source = ticket.source;
      this.dispatch({ type: 'connected', question: ticket.question });
      run.ask();
    } catch (err) {
      console.warn('[tell-me] could not start', err);
      if (this.live === run) this.dispatch({ type: 'skip', why: `couldn't connect (${err instanceof Error ? err.message : err})` });
    }
  }

  private close(letSpeakerFinish = false) {
    const run = this.live;
    this.live = null;
    run?.close(letSpeakerFinish);
  }
}

interface RunEvents {
  /** A piece of the learner's words (added up), or the examiner's words so far this turn (replacing). */
  onText: (who: 'learner' | 'examiner', text: string) => void;
  onVerdict: (args: unknown) => void;
  /** The session ended or failed by itself. */
  onEnd: (why: string) => void;
}

/** One Live session: microphone in, examiner's voice out. */
class LiveRun {
  private speaker = new Speaker();
  private mic = new Mic();
  private session: Session | null = null;
  private closed = false;
  private said = '';
  private newTurn = true;

  constructor(private on: RunEvents) {}

  /**
   * A token, then the microphone, then the Live session. Throws if any of them fails. The token comes first, so
   * the browser doesn't ask for the microphone when the server can't run the question anyway.
   */
  async open(): Promise<LiveTicket> {
    const res = await fetch('/api/live-token', { signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`live-token: HTTP ${res.status}`);
    const ticket = (await res.json()) as LiveTicket;
    if (this.closed) throw new Error('closed');
    await this.mic.open();
    if (this.closed) throw new Error('closed');
    const ai = new GoogleGenAI({ apiKey: ticket.token, httpOptions: { apiVersion: 'v1alpha' } });
    this.session = await ai.live.connect({
      model: ticket.model,
      // Everything else was fixed on the server when the token was made.
      config: { responseModalities: [Modality.AUDIO] },
      callbacks: {
        onmessage: (m) => this.message(m),
        onerror: (e) => this.end(`Live error: ${e.message ?? e.type}`),
        onclose: (e) => this.end(`Live closed (${e.code}${e.reason ? `: ${e.reason}` : ''})`),
      },
    });
    if (this.closed) this.session.close();
    this.mic.onAudio = (b64) => this.session?.sendRealtimeInput({ audio: { data: b64, mimeType: `audio/pcm;rate=${MIC_RATE}` } });
    return ticket;
  }

  /** Has the examiner ask the question. */
  ask() {
    this.session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text: "I'm ready." }] }], turnComplete: true });
  }

  /** T is down: the examiner stops talking and listens. */
  startTurn() {
    this.speaker.stop();
    this.session?.sendRealtimeInput({ activityStart: {} });
    this.mic.sending = true;
  }

  /** T is up: send what's left and tell the examiner the answer is over. */
  endTurn() {
    this.mic.sending = false;
    this.mic.flush();
    this.session?.sendRealtimeInput({ activityEnd: {} });
  }

  close(letSpeakerFinish = false) {
    if (this.closed) return;
    this.closed = true;
    this.session?.close();
    this.mic.close();
    if (letSpeakerFinish) this.speaker.closeWhenDone();
    else this.speaker.close();
  }

  private end(why: string) {
    if (this.closed) return;
    this.on.onEnd(why);
  }

  private message(m: LiveServerMessage) {
    if (this.closed) return;
    const c = m.serverContent;
    if (c?.interrupted) this.speaker.stop();
    for (const part of c?.modelTurn?.parts ?? []) if (part.inlineData?.data) this.speaker.play(part.inlineData.data);
    if (c?.inputTranscription?.text) this.on.onText('learner', c.inputTranscription.text);
    if (c?.outputTranscription?.text) {
      if (this.newTurn) this.said = '';
      this.newTurn = false;
      this.said += c.outputTranscription.text;
      this.on.onText('examiner', this.said);
    }
    if (c?.turnComplete) this.newTurn = true;
    for (const call of m.toolCall?.functionCalls ?? []) {
      // Answered at once, so the examiner goes on to say the verdict.
      this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { output: 'recorded' } }] });
      if (call.name === TOOL_NAME) this.on.onVerdict(call.args);
    }
  }
}

/** Plays the examiner's 24 kHz audio pieces one after another. */
class Speaker {
  private ctx = new AudioContext();
  private next = 0;
  private playing = new Set<AudioBufferSourceNode>();

  play(b64: string) {
    const samples = pcm16Base64ToFloat(b64);
    if (!samples.length) return;
    const buf = this.ctx.createBuffer(1, samples.length, SPEAKER_RATE);
    buf.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime, this.next);
    src.start(at);
    this.next = at + buf.duration;
    this.playing.add(src);
    src.onended = () => this.playing.delete(src);
  }

  stop() {
    for (const src of this.playing) src.stop();
    this.playing.clear();
    this.next = 0;
  }

  close() {
    this.stop();
    void this.ctx.close();
  }

  /** Closes once what's already queued has played. */
  closeWhenDone() {
    const left = Math.max(0, this.next - this.ctx.currentTime);
    setTimeout(() => void this.ctx.close(), left * 1000 + 100);
  }
}

// Copies each block of mic samples out to the page. Loaded from a blob so it needs no file of its own.
const TAP = `registerProcessor('mic-tap', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;

/** The microphone as 16 kHz PCM, sent only while `sending` (T held). */
class Mic {
  // At Live's own rate, so the browser resamples the mic smoothly and downsample() has nothing to do. (Averaging
  // each 100 ms piece on its own would drop a few samples at every join.)
  private ctx = new AudioContext({ sampleRate: MIC_RATE });
  private stream: MediaStream | null = null;
  private pending: Float32Array[] = [];
  private pendingLength = 0;
  private closed = false;
  sending = false;
  onAudio: (b64: string) => void = () => {};

  async open() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    // Allowed only after the question was skipped: let the microphone go again straight away.
    if (this.closed) return this.close();
    const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const tap = new AudioWorkletNode(this.ctx, 'mic-tap');
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => this.take(e.data);
    this.ctx.createMediaStreamSource(this.stream).connect(tap);
    // Some browsers only run nodes that lead somewhere; the tap outputs silence.
    tap.connect(this.ctx.destination);
  }

  private take(samples: Float32Array) {
    if (!this.sending) return;
    this.pending.push(samples);
    this.pendingLength += samples.length;
    if (this.pendingLength >= this.ctx.sampleRate * SEND_EVERY_S) this.flush();
  }

  /** Sends what's waiting. */
  flush() {
    if (!this.pendingLength) return;
    const all = new Float32Array(this.pendingLength);
    let at = 0;
    for (const p of this.pending) {
      all.set(p, at);
      at += p.length;
    }
    this.pending = [];
    this.pendingLength = 0;
    this.onAudio(floatToPcm16Base64(downsample(all, this.ctx.sampleRate)));
  }

  close() {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    if (this.closed) return;
    this.closed = true;
    void this.ctx.close();
  }
}
