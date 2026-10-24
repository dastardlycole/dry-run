import type { Gear, Indicator } from './controls';
import type { CameraMode } from './camera';
import type { Category } from '../faults/types';

const BLINK_MS = 400; // UK indicators flash at roughly 1–2 Hz
const FAULT_MS = 3000;
const CAPTION_MS = 6000;
/** The dial runs 0–70 mph over 240°, from bottom left round to bottom right. */
const DIAL_MAX_MPH = 70;
const DIAL_SWEEP = 240;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Needle angle in degrees from straight up, for the speed dial. */
export function needleAngle(speedMph: number): number {
  const mph = Math.min(Math.abs(speedMph), DIAL_MAX_MPH);
  return -DIAL_SWEEP / 2 + (mph / DIAL_MAX_MPH) * DIAL_SWEEP;
}

export interface HudState {
  speedMph: number;
  gear: Gear;
  indicator: Indicator;
  camera: CameraMode;
  paused: boolean;
}

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private speed = $('speed');
  private gear = $('gear');
  private left = $('ind-left');
  private right = $('ind-right');
  private cam = $('cam-mode');
  private paused = $('paused');
  private bump = $('bump');
  private bumpTimer = 0;
  private faults = $('faults');
  private caption = $('caption');
  private captionTimer = 0;
  private place = $('place');
  private needle = $('needle');
  private lastBlink: boolean | null = null;
  private lastRotate = '';
  /** The indicator flipped on (true) or off (false), for the relay's tick-tock. */
  onBlink: (on: boolean) => void = () => {};

  constructor() {
    // Ticks every 5 mph, numbered every 10.
    const ticks = $('dial-ticks');
    for (let mph = 0; mph <= DIAL_MAX_MPH; mph += 5) {
      const a = (needleAngle(mph) * Math.PI) / 180;
      const major = mph % 10 === 0;
      const at = (r: number) => [70 + r * Math.sin(a), 70 - r * Math.cos(a)];
      const [x1, y1] = at(major ? 52 : 56);
      const [x2, y2] = at(62);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', `${x1}`);
      line.setAttribute('y1', `${y1}`);
      line.setAttribute('x2', `${x2}`);
      line.setAttribute('y2', `${y2}`);
      if (!major) line.setAttribute('class', 'minor');
      ticks.append(line);
      if (major) {
        const [tx, ty] = at(42);
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', `${tx}`);
        label.setAttribute('y', `${ty}`);
        label.textContent = `${mph}`;
        ticks.append(label);
      }
    }
  }

  update(s: HudState, now: number) {
    const mph = `${Math.round(Math.abs(s.speedMph))}`;
    if (this.speed.textContent !== mph) this.speed.textContent = mph;
    const rotate = `rotate(${needleAngle(s.speedMph).toFixed(1)} 70 70)`;
    if (rotate !== this.lastRotate) this.needle.setAttribute('transform', (this.lastRotate = rotate));
    if (this.gear.textContent !== s.gear) this.gear.textContent = s.gear;
    const blinkOn = Math.floor(now / BLINK_MS) % 2 === 0;
    this.left.classList.toggle('on', s.indicator === 'left' && blinkOn);
    this.right.classList.toggle('on', s.indicator === 'right' && blinkOn);
    const blink = s.indicator === 'off' || s.paused ? null : blinkOn;
    // Switched on in the dark half of a flash: wait for the light to come on, so the first sound is a tick.
    if (blink !== null && blink !== this.lastBlink && (this.lastBlink !== null || blink)) this.onBlink(blink);
    this.lastBlink = blink === false && this.lastBlink === null ? null : blink;
    this.cam.textContent = s.camera === 'driver' ? 'Driver view' : 'Chase view';
    this.paused.hidden = !s.paused;
  }

  /** Brief on-screen flash when the car hits something. */
  flashCollision() {
    this.bump.hidden = false;
    clearTimeout(this.bumpTimer);
    this.bumpTimer = window.setTimeout(() => (this.bump.hidden = true), 1200);
  }

  /** Brief on-screen flash for a fault, coloured by category. */
  flashFault(text: string, category: Category) {
    const el = document.createElement('div');
    el.className = `fault ${category}`;
    el.textContent = text;
    this.faults.append(el);
    window.setTimeout(() => el.remove(), FAULT_MS);
  }

  /** What the examiner is saying, for when the sound is off or the room is loud. */
  showCaption(text: string) {
    this.caption.textContent = text;
    this.caption.hidden = false;
    clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => (this.caption.hidden = true), CAPTION_MS);
  }

  /** Where the car is, e.g. "Goodmayes Road · Goodmayes, Ilford". */
  showPlace(text: string) {
    if (this.place.textContent !== text) this.place.textContent = text;
    this.place.hidden = !text;
  }

  clearFaults() {
    this.faults.replaceChildren();
    this.caption.hidden = true;
  }
}
