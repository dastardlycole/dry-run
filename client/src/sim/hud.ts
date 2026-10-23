import type { Gear, Indicator } from './controls';
import type { CameraMode } from './camera';
import type { Category } from '../faults/types';

const BLINK_MS = 400; // UK indicators flash at roughly 1–2 Hz
const FAULT_MS = 3000;
const CAPTION_MS = 6000;

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

  update(s: HudState, now: number) {
    this.speed.textContent = `${Math.round(Math.abs(s.speedMph))} mph`;
    this.gear.textContent = s.gear;
    const blinkOn = Math.floor(now / BLINK_MS) % 2 === 0;
    this.left.classList.toggle('on', s.indicator === 'left' && blinkOn);
    this.right.classList.toggle('on', s.indicator === 'right' && blinkOn);
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

  clearFaults() {
    this.faults.replaceChildren();
    this.caption.hidden = true;
  }
}
