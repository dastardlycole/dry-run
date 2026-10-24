import { wouldFail, type Counts, type Result } from '../faults/result';
import type { Category } from '../faults/types';
import type { TellMeAnswer } from '../examiner/tell-me';
import type { Vec2 } from '../world/types';
import { DebriefView, el, type ResultFault } from './fault-list';

export type { ResultFault } from './fault-list';

// The end-of-test screen (SPEC §4.7 FR-D1): result, counts by category, faults in time order and a
// mini-map with a pin for each. Drawn straight away from the faults the sim found; saving to the
// server happens behind it and only changes the line at the bottom. Once it's saved, the examiner's debrief
// (SPEC §4.7 FR-D2–D4) fills in: mostly written already in the background during the drive, plus the
// examiner's summary of the whole test at the top.

const PIN: Record<Category, string> = { driving: '#ffd24a', serious: '#ff8a3d', dangerous: '#ff4a4a' };
const MAP_PX = 280;

export class ResultScreen {
  private root = document.getElementById('result')!;
  private save = el('p', 'save');
  /** The faults and their debrief on screen now, or null. */
  debrief: DebriefView | null = null;

  constructor(private routeLine: Vec2[]) {}

  get visible() {
    return !this.root.hidden;
  }

  /** `tellMe`: how the 'tell me' question went, if it was asked (a wrong answer is also in `faults`). */
  show(result: Result, counts: Counts, faults: ResultFault[], tellMe: TellMeAnswer | null = null) {
    const card = el('div', 'card');
    const heading = { PASS: ['pass', 'Pass'], FAIL: ['fail', 'Fail'], UNFINISHED: ['unfinished', 'Test not finished'] } as const;
    card.append(el('h1', ...heading[result]));
    if (result === 'UNFINISHED') {
      const worst = counts.dangerous ? 'a dangerous fault' : counts.serious ? 'a serious fault' : 'too many driving faults';
      card.append(
        el(
          'p',
          'unfinished-note',
          wouldFail(counts)
            ? `You'd already made ${worst}, so this would have been a fail.`
            : 'You ended the test before the end of the route.',
        ),
      );
    }

    const tally = el('div', 'counts');
    for (const c of ['driving', 'serious', 'dangerous'] as const) {
      const box = el('div', `count ${c}`);
      box.append(el('b', '', String(counts[c])), el('span', '', c));
      tally.append(box);
    }
    card.append(tally);
    if (tellMe) {
      const ok = tellMe.verdict === 'correct';
      card.append(el('p', `tellme ${ok ? 'pass' : 'fail'}`, `‘Tell me’ question (${tellMe.question.topic}): ${ok ? 'correct' : 'not quite, 1 driving fault'}`));
    }

    this.debrief = new DebriefView(faults, 'No faults. Well driven.');
    const body = el('div', 'body');
    body.append(this.debrief.list, this.miniMap(faults));
    card.append(this.debrief.summary, body, this.debrief.note, this.save, el('p', 'keys', 'Press R to drive again'));
    this.root.replaceChildren(card);
    this.root.hidden = false;
  }

  /** The line about saving to the server. */
  setSave(text: string) {
    this.save.textContent = text;
  }

  hide() {
    this.root.hidden = true;
    this.root.replaceChildren();
    this.debrief = null;
  }

  /** The route from above (north up) with a numbered pin per fault. */
  private miniMap(faults: ResultFault[]) {
    const canvas = el('canvas', 'minimap');
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = canvas.height = MAP_PX * dpr;
    canvas.style.width = canvas.style.height = `${MAP_PX}px`;
    const g = canvas.getContext('2d');
    const pts = this.routeLine;
    if (!g || pts.length < 2) return canvas;
    g.scale(dpr, dpr);

    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const pad = 18;
    const scale = (MAP_PX - 2 * pad) / Math.max(maxX - minX, maxZ - minZ, 1);
    // x is east and z is south, the same way round as the canvas.
    const ox = (MAP_PX - (maxX - minX) * scale) / 2;
    const oz = (MAP_PX - (maxZ - minZ) * scale) / 2;
    const at = ([x, z]: Vec2): Vec2 => [ox + (x - minX) * scale, oz + (z - minZ) * scale];

    g.fillStyle = '#1d2a22';
    g.fillRect(0, 0, MAP_PX, MAP_PX);
    g.strokeStyle = '#9aa5ad';
    g.lineWidth = 3;
    g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(...at(p)) : g.moveTo(...at(p))));
    g.stroke();
    g.fillStyle = '#3c6';
    g.beginPath();
    g.arc(...at(pts[0]), 5, 0, Math.PI * 2);
    g.fill();

    g.font = 'bold 10px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    faults.forEach((f, i) => {
      const [x, y] = at(f.pos);
      g.fillStyle = PIN[f.category];
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = f.category === 'dangerous' ? '#fff' : '#111';
      g.fillText(String(i + 1), x, y + 0.5);
    });
    return canvas;
  }
}
