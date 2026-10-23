import type { Gear, Indicator } from './controls';
import type { CameraMode } from './camera';

const BLINK_MS = 400; // UK indicators flash at roughly 1–2 Hz

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
}
