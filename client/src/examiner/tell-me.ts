import type { Fault } from '../faults/types';
import type { Vec2 } from '../world/types';

// The 'tell me' question before setting off (SPEC §4.5 FR-E3). The examiner (Gemini Live) asks one official
// DVSA question, the learner answers by voice while holding T, and the model compares the answer with the
// official one and calls submit_tell_me_answer. As on the real test, a wrong answer is one driving fault (R15).
// Everything here is plain logic; tell-me-live.ts does the audio and the network. Driving never waits for it:
// any step that takes too long, or any driving key, skips the question.

/** One question from assets/guidance/tell-me.json, in the gov.uk wording. */
export interface TellMeQuestion {
  id: string;
  topic: string;
  question: string;
  answer: string;
}

/** assets/guidance/tell-me.json. */
export interface TellMeFile {
  source: string;
  url: string;
  licence: string;
  questions: TellMeQuestion[];
}

/** GET /api/live-token: a one-use Gemini Live token, already locked to this question. */
export interface LiveTicket {
  token: string;
  model: string;
  question: TellMeQuestion;
  source: { url: string; licence: string };
}

export const TOOL_NAME = 'submit_tell_me_answer';

export interface TellMeVerdict {
  verdict: 'correct' | 'incorrect';
  reason: string;
}

/** How the question went, for the fault and the result screen. */
export interface TellMeAnswer extends TellMeVerdict {
  question: TellMeQuestion;
}

const MAX_REASON = 300;

/** The tool call's arguments, if they're a real verdict. Anything else counts as no verdict at all. */
export function parseVerdict(args: unknown): TellMeVerdict | null {
  if (!args || typeof args !== 'object') return null;
  const { verdict, reason } = args as Record<string, unknown>;
  if (verdict !== 'correct' && verdict !== 'incorrect') return null;
  const text = typeof reason === 'string' ? reason.trim().replace(/\s+/g, ' ').slice(0, MAX_REASON) : '';
  return { verdict, reason: text };
}

/** Where the R15 fault is filed: it isn't at a junction, so it never joins a junction's stats. */
export const TELL_ME_JUNCTION = 'test-centre';

/** A wrong answer is one driving fault (DVSA), logged when the drive starts, at the test centre. */
export function tellMeFault(answer: TellMeAnswer, t: number, pos: Vec2): Fault | null {
  if (answer.verdict !== 'incorrect') return null;
  return {
    ruleId: 'R15',
    category: 'driving',
    t,
    pos,
    speedMph: 0,
    junctionId: TELL_ME_JUNCTION,
    context: { questionId: answer.question.id, question: answer.question.question, reason: answer.reason },
  };
}

/** Longest each step may take before the question is skipped. */
export const LIMIT_MS = {
  /** Token, microphone and Live connection (includes the first "allow the microphone?" prompt). */
  connecting: 15_000,
  /** From connected to T being pressed: the examiner asks, then waits for an answer. */
  asking: 45_000,
  /** Holding T. */
  listening: 30_000,
  /** From letting go of T to the verdict. */
  judging: 15_000,
  /** The verdict stays up this long, unless a key is pressed. */
  verdict: 8_000,
} as const;

export type Phase = 'offered' | 'connecting' | 'asking' | 'listening' | 'judging' | 'verdict' | 'done' | 'skipped';

export interface FlowState {
  phase: Phase;
  /** When this phase began (ms). */
  since: number;
  question?: TellMeQuestion;
  verdict?: TellMeVerdict;
  /** Why it was skipped, for the console. */
  why?: string;
}

export type FlowEvent =
  | { type: 'start' }
  | { type: 'connected'; question: TellMeQuestion }
  | { type: 'pressT' }
  | { type: 'releaseT' }
  | { type: 'verdict'; verdict: TellMeVerdict }
  | { type: 'dismiss' }
  | { type: 'skip'; why: string }
  | { type: 'tick' };

export const offered = (now: number): FlowState => ({ phase: 'offered', since: now });

/** True until the question is over (answered or skipped): the drive waits to start until then. */
export const isBusy = (s: FlowState) => s.phase !== 'done' && s.phase !== 'skipped';

/** The next state. Events that don't fit the current phase change nothing. */
export function step(s: FlowState, e: FlowEvent, now: number): FlowState {
  if (!isBusy(s)) return s;
  const to = (phase: Phase, extra: Partial<FlowState> = {}): FlowState => ({ ...s, ...extra, phase, since: now });
  switch (e.type) {
    case 'start':
      return s.phase === 'offered' ? to('connecting') : s;
    case 'connected':
      return s.phase === 'connecting' ? to('asking', { question: e.question }) : s;
    case 'pressT':
      // From judging too: the examiner may ask to hear the answer again.
      return s.phase === 'asking' || s.phase === 'judging' ? to('listening') : s;
    case 'releaseT':
      return s.phase === 'listening' ? to('judging') : s;
    case 'verdict':
      // A verdict while the learner is still talking (or before) is the model jumping the gun: keep it anyway,
      // since the answer it heard is what it judged.
      return s.phase === 'asking' || s.phase === 'listening' || s.phase === 'judging' ? to('verdict', { verdict: e.verdict }) : s;
    case 'dismiss':
      return s.phase === 'verdict' ? to('done') : s;
    case 'skip':
      return s.phase === 'verdict' ? to('done') : to('skipped', { why: e.why });
    case 'tick': {
      if (s.phase === 'offered') return s;
      if (now - s.since < LIMIT_MS[s.phase as keyof typeof LIMIT_MS]) return s;
      if (s.phase === 'verdict') return to('done');
      // Held T too long: judge what was said so far.
      if (s.phase === 'listening') return to('judging');
      return to('skipped', { why: `${s.phase} took too long` });
    }
  }
}

/** How it ended: the answer if there was a verdict, else null (skipped). */
export function outcome(s: FlowState): TellMeAnswer | null {
  return s.phase === 'done' && s.question && s.verdict ? { ...s.verdict, question: s.question } : null;
}
