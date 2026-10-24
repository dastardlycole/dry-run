import { RULE_NAMES, type Category, type RuleId } from '../../../client/src/faults/types';

// One saved fault in plain words, for the vector search query and the Argon prompt. Built only from
// what the fault engine recorded: the AI is told what happened, it never decides it.

export interface DebriefFault {
  _id: string;
  ruleId: RuleId;
  category: Category;
  junctionId: string;
  speedMph: number;
  context: Record<string, unknown>;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

function turn(c: Record<string, unknown>): string {
  const exit = num(c.exit);
  if (c.action === 'roundabout') return exit ? `taking the ${ordinal(exit)} exit at a roundabout` : 'at a roundabout';
  return c.action === 'left' || c.action === 'right' ? `turning ${c.action} at a junction` : 'at a junction';
}

/** What happened, e.g. "Speeding (serious fault): 43 mph in a 30 mph limit." */
export function describeFault(f: DebriefFault): string {
  const c = f.context ?? {};
  const speed = Math.round(f.speedMph);
  let what: string;
  switch (f.ruleId) {
    case 'R1':
      what = `${speed} mph in a ${num(c.limitMph) ?? '?'} mph limit`;
      break;
    case 'R2':
      what = `crossed the stop line at traffic lights showing ${c.light === 'redAmber' ? 'red and amber' : 'red'}, at ${speed} mph`;
      break;
    case 'R3':
      what = `switched the ${str(c.indicator) ?? ''} indicator on without checking the mirrors first`;
      break;
    case 'R4':
      what = `no mirror check before ${turn(c)}`;
      break;
    case 'R5':
      what = `no ${str(c.expected) ?? ''} signal before ${turn(c)}`;
      break;
    case 'R6':
      what = `signalled ${str(c.shown) ?? 'the wrong way'} instead of ${str(c.expected) ?? 'the right way'} when ${turn(c)}`;
      break;
    case 'R7': {
      const missed = Array.isArray(c.missed) ? c.missed.filter((x) => x === 'left' || x === 'right') : [];
      const ways = missed.length === 1 ? missed[0] : 'left or right';
      const where = c.action === 'roundabout' ? `the give-way line, ${turn(c)}` : `the line at a junction${c.action === 'left' || c.action === 'right' ? `, turning ${c.action}` : ''}`;
      what = `didn't look ${ways} in the few seconds before crossing ${where}`;
      break;
    }
    case 'R8': {
      const missed = Array.isArray(c.missed) ? c.missed : [];
      const checks = [missed.includes('mirror') ? 'the mirrors' : '', missed.includes('right') ? 'over the right shoulder (blind spot)' : ''].filter(Boolean);
      what = `pulled away from the side of the road without checking ${checks.join(' or ') || 'all around'}`;
      break;
    }
    case 'R9': {
      const lanes = num(c.lanes);
      what = `approached in lane ${num(c.lane) ?? '?'} of ${lanes ?? '?'} (counting from the left) when ${turn(c)}; the correct lane was lane ${num(c.expectedLane) ?? '?'}`;
      break;
    }
    case 'R11':
      what = `hit ${c.with === 'parkedCar' ? 'a parked car' : c.with === 'building' ? 'a building or wall' : 'something'} at ${speed} mph`;
      break;
    case 'R15':
      what = `before setting off, didn't give the official answer to the 'tell me' question "${str(c.question) ?? 'about the car'}"${str(c.reason) ? ` (examiner: ${str(c.reason)})` : ''}`;
      break;
  }
  return `${RULE_NAMES[f.ruleId]} (${f.category} fault): ${what.replace(/\s+/g, ' ')}.`;
}
