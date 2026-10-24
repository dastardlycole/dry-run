import { describe, expect, it } from 'vitest';
import { pickVoice } from '../examiner/voice';
import { engineTone } from './engine-sound';

describe('engineTone', () => {
  it('idles low and quiet', () => {
    const idle = engineTone(0, false);
    expect(idle.freq).toBeLessThan(60);
    expect(idle.gain).toBeLessThan(0.5);
  });

  it('revs higher with the pedal down', () => {
    expect(engineTone(20, true).freq).toBeGreaterThan(engineTone(20, false).freq);
    expect(engineTone(20, true).gain).toBeGreaterThan(engineTone(20, false).gain);
  });

  it('rises within a gear, drops back on the change up, and stays in range', () => {
    expect(engineTone(15, false).freq).toBeGreaterThan(engineTone(5, false).freq);
    expect(engineTone(19, false).freq).toBeLessThan(engineTone(17, false).freq);
    for (let mph = 0; mph <= 90; mph += 1) {
      const t = engineTone(mph, true);
      expect(t.freq).toBeLessThan(250);
      expect(t.gain).toBeLessThanOrEqual(1);
    }
  });

  it('treats reverse speed like forward speed', () => {
    expect(engineTone(-8, false)).toEqual(engineTone(8, false));
  });
});

describe('pickVoice', () => {
  const v = (name: string, lang = 'en-GB') => ({ name, lang });

  it('prefers a male British voice', () => {
    const voices = [v('Google US English', 'en-US'), v('Google UK English Female'), v('Google UK English Male')];
    expect(pickVoice(voices)?.name).toBe('Google UK English Male');
    expect(pickVoice([v('Microsoft Hazel'), v('Microsoft Ryan Online (Natural)')])?.name).toContain('Ryan');
  });

  it('falls back to any British voice, then none', () => {
    expect(pickVoice([v('Samantha', 'en-US'), v('Microsoft Hazel', 'en_GB')])?.name).toBe('Microsoft Hazel');
    expect(pickVoice([v('Samantha', 'en-US')])).toBeUndefined();
  });
});
