// Gemini TTS for the examiner's voice (SPEC §4.5). Shared by tools/src/gen-tts.ts, which pre-makes the fixed
// sentences, and the server, which voices each test's examiner's summary as it's written, so both sound alike.

export const MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_VOICE = 'Charon';
export const TIMEOUT_MS = 30_000;
// In this layout the model takes the notes as direction and only speaks the transcript. A plain
// "Say this calmly: …" prefix gets read out loud.
// Now and then it reads the notes out anyway. For a short sentence that's caught (the clip comes back far too
// long, see tts()), but in a long text like the end-of-test summary the extra seconds hide in the slack, so
// long texts go without notes: the voice itself (Charon) is set in the request either way.
export const NOTES_UP_TO_WORDS = 18;
export const prompt = (text: string) =>
  text.split(/\s+/).length > NOTES_UP_TO_WORDS
    ? text
    : `### DIRECTOR'S NOTES
Style: calm, clear, friendly UK driving examiner. Accent: neutral southern British (RP). Pace: unhurried.

### TRANSCRIPT
${text}`;
/** Silence kept before and after the words, and what counts as silence (16-bit samples). */
const PAD_S = 0.15;
const QUIET = 300;

export interface Clip {
  /** 16-bit mono PCM. */
  pcm: Buffer;
  rate: number;
}

/**
 * One sentence (or a few) as audio. Now and then the model reads the director's notes out too; that clip is
 * far too long for the words, so it's thrown away and asked for again.
 */
export async function tts(apiKey: string, text: string, voice = DEFAULT_VOICE, tries = 3): Promise<Clip> {
  const maxS = text.split(/\s+/).length / 1.5 + 1.5;
  for (let i = 1; ; i++) {
    const clip = await ttsOnce(apiKey, text, voice);
    const seconds = clip.pcm.length / 2 / clip.rate;
    if (seconds <= maxS) return clip;
    if (i >= tries) throw new Error(`${MODEL}: "${text}" came back ${seconds.toFixed(1)} s long ${tries} times`);
    console.warn(`  ${seconds.toFixed(1)} s is too long for "${text}"; trying again`);
  }
}

async function ttsOnce(apiKey: string, text: string, voice: string): Promise<Clip> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt(text) }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${MODEL}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as any;
  const data = body.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!data) throw new Error(`${MODEL}: no audio in reply: ${JSON.stringify(body).slice(0, 300)}`);
  const { pcm, rate } = audioOf(Buffer.from(data.data, 'base64'), data.mimeType);
  return { pcm: trimSilence(pcm, rate), rate };
}

/**
 * The samples in a reply. Gemini used to send bare 16-bit PCM; now it can send a whole WAV file, with a
 * provenance (C2PA) block after the audio. Played as sound, that block is a loud scratch at the end, so
 * only the 'data' chunk is kept.
 */
export function audioOf(bytes: Buffer, mimeType = ''): Clip {
  const fallbackRate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') {
    return { pcm: bytes, rate: fallbackRate };
  }
  let rate = fallbackRate;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = bytes.toString('latin1', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') rate = bytes.readUInt32LE(body + 4);
    if (id === 'data') return { pcm: bytes.subarray(body, Math.min(bytes.length, body + size)), rate };
    at = body + size + (size & 1); // chunks are padded to an even length
  }
  throw new Error(`${MODEL}: WAV reply has no audio data`);
}

/** Cuts silence at the start and end, so the sim's timing of directions is about the words. */
function trimSilence(pcm: Buffer, rate: number): Buffer {
  const n = pcm.length >> 1;
  const loud = (i: number) => Math.abs(pcm.readInt16LE(i * 2)) > QUIET;
  let a = 0;
  while (a < n && !loud(a)) a++;
  let b = n - 1;
  while (b > a && !loud(b)) b--;
  const pad = Math.round(PAD_S * rate);
  return pcm.subarray(Math.max(0, a - pad) * 2, Math.min(n, b + 1 + pad) * 2);
}

/** Wraps raw 16-bit mono PCM in a WAV header so browsers can decode it. */
export function wav({ pcm, rate }: Clip): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
