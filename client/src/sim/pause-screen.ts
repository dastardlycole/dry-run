import { wouldFail, type Counts } from '../faults/result';
import { clock, DebriefView, el, type ResultFault } from './fault-list';

// The pause screen (Esc): a game-style look at the test so far. A stats strip (time, faults by category, on
// course to pass or not) and the faults with the examiner's debrief, which the server has been writing in the
// background while you drove: anything ready shows at once, the rest fills in while you look.

export class PauseScreen {
  private root = document.getElementById('pause-card')!;
  /** The faults and their debrief on screen now, or null. */
  debrief: DebriefView | null = null;

  show(simTime: number, counts: Counts, faults: ResultFault[]) {
    const card = el('div', 'card');

    const stats = el('div', 'stats');
    const time = el('div', 'stat');
    time.append(el('b', '', clock(simTime)), el('span', '', 'driven'));
    stats.append(time);
    for (const c of ['driving', 'serious', 'dangerous'] as const) {
      const box = el('div', `stat count ${c}`);
      box.append(el('b', '', String(counts[c])), el('span', '', c));
      stats.append(box);
    }
    const passing = !wouldFail(counts);
    const course = el('div', `stat course ${passing ? 'pass' : 'fail'}`);
    course.append(el('b', '', passing ? 'On course' : 'Fail'), el('span', '', passing ? 'to pass' : 'if this were the test'));
    stats.append(course);
    card.append(stats);

    this.debrief = new DebriefView(faults, 'No faults so far. Keep it up.');
    card.append(this.debrief.list, this.debrief.note);
    this.root.replaceChildren(card);
  }

  hide() {
    this.root.replaceChildren();
    this.debrief = null;
  }
}
