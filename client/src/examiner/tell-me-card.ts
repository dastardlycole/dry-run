import { el } from '../sim/fault-list';
import type { FlowState, LiveTicket } from './tell-me';

// The 'tell me' question's card, near the top of the screen so the car stays in view. Drawn again from scratch
// at every change: it's a handful of lines.

export interface CardExtras {
  /** What the learner has said so far (Gemini's transcript of it). */
  heard: string;
  /** What the examiner said last. */
  said: string;
  source?: LiveTicket['source'];
}

export class TellMeCard {
  private root = document.getElementById('tellme')!;

  render(s: FlowState, x: CardExtras) {
    const card = el('div', `card ${s.phase}`);
    const q = s.question ? el('p', 'question', s.question.question) : null;
    const heard = x.heard.trim() ? el('p', 'heard', `You said: “${x.heard.trim()}”`) : null;
    const said = x.said.trim() ? el('p', 'said', `Examiner: “${x.said.trim()}”`) : null;
    switch (s.phase) {
      case 'offered':
        card.append(
          el('h2', '', 'Before we set off'),
          el('p', '', 'The examiner will ask you a ‘tell me’ question about the car, as on the real test.'),
          el('p', 'keys', 'Press T to hear it · or just drive off to skip'),
        );
        break;
      case 'connecting':
        card.append(el('h2', '', 'Getting the examiner…'), el('p', 'keys', 'Allow the microphone if your browser asks.'));
        break;
      case 'asking':
        card.append(el('h2', '', '‘Tell me’ question'), q!, ...(said ? [said] : []), el('p', 'keys', 'Hold T and answer out loud'));
        break;
      case 'listening':
        card.append(el('h2', 'live', 'Listening…'), q!, ...(heard ? [heard] : []), el('p', 'keys', 'Let go of T when you’ve finished'));
        break;
      case 'judging':
        card.append(el('h2', '', 'Examiner is thinking…'), q!, ...(heard ? [heard] : []), ...(said ? [said] : []));
        break;
      case 'verdict': {
        const ok = s.verdict!.verdict === 'correct';
        card.append(el('h2', ok ? 'pass' : 'fail', ok ? '✓ Correct' : '✗ Not quite · 1 driving fault'), q!);
        if (heard) card.append(heard);
        if (s.verdict!.reason) card.append(el('p', 'reason', s.verdict!.reason));
        card.append(el('p', 'official', `Official DVSA answer: ${s.question!.answer}`));
        if (x.source) {
          const a = el('a', 'cite', `DVSA ‘show me, tell me’ questions, gov.uk (${x.source.licence})`);
          a.href = x.source.url;
          a.target = '_blank';
          a.rel = 'noopener';
          card.append(el('p', 'cites'));
          card.lastElementChild!.append(a);
        }
        card.append(el('p', 'keys', 'Press T or drive off to set off'));
        break;
      }
      case 'done':
      case 'skipped':
        this.root.hidden = true;
        this.root.replaceChildren();
        return;
    }
    this.root.replaceChildren(card);
    this.root.hidden = false;
  }
}
