import type { Contact } from '../faults/types';

// What the car is touching, for R11. Physics runs several steps per rendered frame, and the fault
// engine only looks once a frame, so a hit that starts and ends between two looks is kept until then.

export class Contacts {
  private now = new Map<number, Contact>();
  private hit: Contact | null = null;

  /** The car started touching collider `handle`. */
  start(handle: number, kind: Contact) {
    this.now.set(handle, kind);
    this.hit ??= kind;
  }

  stop(handle: number) {
    this.now.delete(handle);
  }

  /** What the car touched since the last call (even if it has already bounced off), or null. */
  take(): Contact | null {
    const c = this.hit ?? this.now.values().next().value ?? null;
    this.hit = null;
    return c;
  }

  clear() {
    this.now.clear();
    this.hit = null;
  }
}
