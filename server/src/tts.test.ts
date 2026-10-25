import { describe, expect, it } from 'vitest';
import { audioOf, wav, prompt, NOTES_UP_TO_WORDS } from './tts';

// Gemini TTS replies: bare PCM, or a whole WAV with a provenance block after the audio (heard as a scratch).

const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
const chunk = (id: string, body: Buffer) => {
  const h = Buffer.alloc(8);
  h.write(id, 0, 'latin1');
  h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};

describe('audioOf', () => {
  it('keeps bare PCM as it is, with the rate from the mime type', () => {
    expect(audioOf(pcm, 'audio/L16;codec=pcm;rate=24000')).toEqual({ pcm, rate: 24000 });
  });

  it('takes only the samples out of a WAV, dropping the block after them', () => {
    const inner = wav({ pcm, rate: 22050 });
    const withCredentials = Buffer.concat([inner, chunk('C2PA', Buffer.from('calgfsha256 provenance', 'latin1'))]);
    const clip = audioOf(withCredentials, 'audio/wav');
    expect(clip.rate).toBe(22050);
    expect([...clip.pcm]).toEqual([...pcm]);
  });

  it('skips other chunks before the audio, including odd-sized ones', () => {
    const fmt = wav({ pcm, rate: 24000 }).subarray(12, 36);
    const file = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), chunk('LIST', Buffer.from('abc')), fmt, chunk('data', pcm)]);
    expect([...audioOf(file).pcm]).toEqual([...pcm]);
  });
});

describe('prompt', () => {
  it("gives a short sentence the director's notes", () => {
    expect(prompt('At the roundabout, take the first exit.')).toContain("DIRECTOR'S NOTES");
  });

  it('sends a long text like the summary on its own, so the notes are never read out with it', () => {
    const summary = Array.from({ length: NOTES_UP_TO_WORDS + 1 }, () => 'word').join(' ');
    expect(prompt(summary)).toBe(summary);
  });
});
