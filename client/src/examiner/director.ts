import { OPENING, type Direction } from './phrases';

// When to say each direction (SPEC §4.4 FR-R2): early enough that it has finished at least
// LEAD_S seconds before the manoeuvre at the current speed, and always in route order.

export const LEAD_S = 4;
/** Never later than this, so a slow or stopped car still hears it in good time. */
export const MIN_LEAD_M = 40;
/** A calm examiner's pace, for guessing how long a sentence takes to say (the Gemini clips run at about this). */
const WORDS_PER_S = 2;
/** The car has to be this far past the last manoeuvre before the next direction, so they don't overlap. */
const PASSED_M = 5;
/**
 * Further than this from the route's driving line, the car has left the route (missed a turn, drove
 * off): its place on the route is only a guess then, so no directions until it's back.
 */
export const OFF_ROUTE_M = 15;
/** A first manoeuvre this close to the start is given with the opening, while the car is still parked. */
export const START_DIRECTION_M = 200;

export const speechSeconds = (text: string) => text.trim().split(/\s+/).length / WORDS_PER_S;

/** How far before a manoeuvre its direction must start at `speedMs`. */
export function leadDistanceM(text: string, speedMs: number): number {
  return Math.max(MIN_LEAD_M, Math.abs(speedMs) * (LEAD_S + speechSeconds(text)));
}

export class Director {
  /** Indexes of the directions already given. */
  private said = new Set<number>();
  private openingSaid = false;

  constructor(private directions: Direction[]) {}

  reset() {
    this.said.clear();
    this.openingSaid = false;
  }

  /** The last direction (on a test route, "pull up on the left") has been given. */
  get finished(): boolean {
    return this.directions.length > 0 && this.said.has(this.directions.length - 1);
  }

  /**
   * Sentences to start saying now, given the car's distance along the route, its speed (m/s) and how
   * far it is from the route's driving line.
   */
  update(m: number, speedMs: number, offM = 0): string[] {
    const out: string[] = [];
    if (!this.openingSaid) {
      this.openingSaid = true;
      out.push(OPENING);
      const first = this.directions[0];
      if (first && first.atM - m <= START_DIRECTION_M) {
        out.push(first.text);
        this.said.add(0);
      }
    }
    if (offM > OFF_ROUTE_M) return out;
    // The next manoeuvre ahead of the car. Ones behind it are left unsaid, not dropped: if the car's
    // place on the route jumped forward by mistake and comes back, they're still given.
    const i = this.directions.findIndex((d) => d.atM >= m);
    if (i < 0 || this.said.has(i)) return out;
    const d = this.directions[i];
    const prev = this.directions[i - 1];
    if (prev && m < prev.endM + PASSED_M) return out;
    if (d.atM - m <= leadDistanceM(d.text, speedMs)) {
      out.push(d.text);
      this.said.add(i);
    }
    return out;
  }
}
