import type { DriveInput } from './controls';

// One-press actions. Held keys (driving, look, mirror) are read every frame instead.
export type Action = 'indicateLeft' | 'indicateRight' | 'camera' | 'pause' | 'reset' | 'guide' | 'end';

const ACTIONS: Record<string, Action> = {
  KeyZ: 'indicateLeft',
  KeyX: 'indicateRight',
  KeyC: 'camera',
  Escape: 'pause',
  KeyR: 'reset',
  KeyG: 'guide',
  Enter: 'end',
  NumpadEnter: 'end',
};

// Keys the browser would otherwise use for scrolling.
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  private held = new Set<string>();
  private queue: Action[] = [];
  /** M went down since the fault engine last looked, so a quick tap between two frames still counts. */
  private mirrorTapped = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      // Repeats still mark the key as held: after a blur, a key held down only sends repeats.
      this.held.add(e.code);
      if (e.code === 'KeyM') this.mirrorTapped = true;
      if (e.repeat) return;
      const action = ACTIONS[e.code];
      if (action) this.queue.push(action);
    });
    target.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    // Don't leave keys stuck down if the window loses focus mid-press.
    target.addEventListener('blur', () => {
      this.held.clear();
    });
  }

  /** True if M is held, or was pressed at all since the last call. Read once per frame by the fault engine (R3/R4). */
  takeMirrorCheck(): boolean {
    const checked = this.mirror || this.mirrorTapped;
    this.mirrorTapped = false;
    return checked;
  }

  private any(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  drive(): DriveInput {
    return {
      throttle: this.any('KeyW', 'ArrowUp'),
      brake: this.any('KeyS', 'ArrowDown'),
      left: this.any('KeyA', 'ArrowLeft'),
      right: this.any('KeyD', 'ArrowRight'),
      handbrake: this.any('Space'),
    };
  }

  get lookLeft() { return this.any('KeyQ'); }
  get lookRight() { return this.any('KeyE'); }
  get mirror() { return this.any('KeyM'); }

  /** Returns and clears the one-press actions since the last call. */
  takeActions(): Action[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}
