import { describe, expect, it } from 'vitest';
import type { DebriefLine } from '../net/debrief';
import { fetchExplanation } from './examiner-panel';

const fault = (faultId: string, text: string | null, temporary = false): DebriefLine => ({
  kind: 'fault',
  faultId,
  junction: null,
  text,
  citations: text ? [{ id: 'hc-159', title: 'Rule 159', url: 'https://example.org/159' }] : [],
  temporary,
});

/** A debrief stream that sends `rounds[n]` on its nth call, stopping early once aborted. */
function fakeStream(rounds: DebriefLine[][]) {
  let calls = 0;
  const stream = async (_id: string, onLine: (l: DebriefLine) => void, signal?: AbortSignal) => {
    for (const line of rounds[calls++] ?? []) {
      if (signal?.aborted) return false;
      onLine(line);
    }
    return true;
  };
  return { stream, calls: () => calls };
}

describe('fetchExplanation', () => {
  it('picks out the asked-for fault and stops reading', async () => {
    const seen: string[] = [];
    const { stream } = fakeStream([[fault('a', 'old one'), fault('b', 'Check your mirrors.'), fault('c', 'later')]]);
    const spy: typeof stream = (id, onLine, signal) => stream(id, (l) => (l.kind === 'fault' && seen.push(l.faultId), onLine(l)), signal);
    const got = await fetchExplanation('s', 'b', new AbortController().signal, { stream: spy });
    expect(got?.text).toBe('Check your mirrors.');
    expect(got?.citations[0].title).toBe('Rule 159');
    expect(seen).toEqual(['a', 'b']);
  });

  it('asks once more when the explanation was not written yet for a passing reason', async () => {
    const f = fakeStream([[fault('b', null, true)], [fault('b', 'Now ready.')]]);
    const got = await fetchExplanation('s', 'b', new AbortController().signal, { stream: f.stream, retryMs: 0 });
    expect(got?.text).toBe('Now ready.');
    expect(f.calls()).toBe(2);
  });

  it('gives null without asking again when there is no checked explanation', async () => {
    const f = fakeStream([[fault('b', null)], [fault('b', 'never asked')]]);
    expect(await fetchExplanation('s', 'b', new AbortController().signal, { stream: f.stream, retryMs: 0 })).toBeNull();
    expect(f.calls()).toBe(1);
  });

  it('gives null when the fault is not in the stream (not saved yet, or offline)', async () => {
    const f = fakeStream([[fault('a', 'other'), { kind: 'done', unavailable: false }]]);
    expect(await fetchExplanation('s', 'b', new AbortController().signal, { stream: f.stream, retryMs: 0 })).toBeNull();
  });

  it('gives null once the caller has given up', async () => {
    const abort = new AbortController();
    abort.abort();
    const f = fakeStream([[fault('b', 'too late')]]);
    expect(await fetchExplanation('s', 'b', abort.signal, { stream: f.stream })).toBeNull();
    expect(f.calls()).toBe(0);
  });
});
