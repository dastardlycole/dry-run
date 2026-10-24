import { sharedAudio } from '../examiner/voice';

// A soft engine hum made with the Web Audio API (no audio files): two oscillators through a low-pass filter.
// It shares the examiner's AudioContext, so the first key press that unlocks the voice unlocks this too.

/** Each "gear" covers this many mph: the pitch climbs through it, then drops back as if changing up. */
const GEAR_MPH = 18;
const IDLE_HZ = 52;
const MAX_VOLUME = 0.07;
/** The engine under the examiner: about a third as loud. */
const DUCK = 0.3;

export interface EngineTone {
  /** Base pitch, Hz. */
  freq: number;
  /** 0–1 before the master volume. */
  gain: number;
  /** Low-pass cutoff, Hz: brighter when working harder. */
  cutoff: number;
}

/** How the engine sounds at this speed, with or without the pedal down. Pure, so it can be tested. */
export function engineTone(speedMph: number, pressing: boolean): EngineTone {
  const mph = Math.min(Math.abs(speedMph), 70);
  const gear = Math.min(Math.floor(mph / GEAR_MPH), 3);
  // Within each gear revs rise from about 40% to 100%; higher gears sit a little higher overall.
  const inGear = gear === 3 ? Math.min((mph - 3 * GEAR_MPH) / GEAR_MPH, 1) : (mph % GEAR_MPH) / GEAR_MPH;
  const revs = mph < 1 ? 0 : 0.4 + 0.6 * inGear + gear * 0.12;
  const freq = IDLE_HZ * (1 + revs * 1.4) * (pressing ? 1.12 : 1);
  const gain = 0.45 + 0.35 * Math.min(mph / 70, 1) + (pressing ? 0.2 : 0);
  const cutoff = 350 + revs * 450 + (pressing ? 250 : 0);
  return { freq, gain: Math.min(gain, 1), cutoff };
}

export class EngineSound {
  /** N: no engine and no indicator relay. */
  muted = false;
  private silent = false;
  private nodes: { low: OscillatorNode; high: OscillatorNode; filter: BiquadFilterNode; out: GainNode } | null = null;

  /** Once a frame. `quiet` (paused, start card, result screen, tell me question) fades the engine out. */
  update(speedMph: number, pressing: boolean, talking: boolean, quiet: boolean) {
    const ctx = sharedAudio();
    if (!ctx || ctx.state !== 'running') return;
    const n = (this.nodes ??= this.build(ctx));
    const silent = this.muted || quiet;
    // Already faded out: nothing to change until it's heard again.
    if (silent && this.silent) return;
    this.silent = silent;
    const tone = engineTone(speedMph, pressing);
    const t = ctx.currentTime;
    n.low.frequency.setTargetAtTime(tone.freq, t, 0.08);
    n.high.frequency.setTargetAtTime(tone.freq * 2, t, 0.08);
    n.filter.frequency.setTargetAtTime(tone.cutoff, t, 0.1);
    const volume = silent ? 0 : tone.gain * MAX_VOLUME * (talking ? DUCK : 1);
    n.out.gain.setTargetAtTime(volume, t, 0.1);
  }

  /** The indicator relay: a short click, higher for "tick" (on) than "tock" (off). */
  tick(on: boolean) {
    const ctx = sharedAudio();
    if (this.muted || !ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = on ? 1800 : 1300;
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  private build(ctx: AudioContext) {
    const low = ctx.createOscillator();
    low.type = 'sawtooth';
    const high = ctx.createOscillator();
    high.type = 'square';
    high.detune.value = 7; // a slight beat between the two sounds less like a test tone
    const mixHigh = ctx.createGain();
    mixHigh.gain.value = 0.35;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    const out = ctx.createGain();
    out.gain.value = 0;
    low.connect(filter);
    high.connect(mixHigh).connect(filter);
    filter.connect(out).connect(ctx.destination);
    low.start();
    high.start();
    return { low, high, filter, out };
  }
}
