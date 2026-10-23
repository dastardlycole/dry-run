// Pre-generates the examiner's sentences as audio with Gemini TTS (SPEC §4.5 FR-E1), so the sim never
// waits on the network to speak. Writes assets/audio/*.wav and assets/audio/manifest.json
// (sentence → file). Sentences come from the same code the sim uses (client/src/examiner/phrases.ts),
// for every route-*.json in assets/<centre>. Files that already exist are kept unless --force.
//
//   npm run gen-tts -w tools                     all sentences, default voice
//   npm run gen-tts -w tools -- --voice Kore     another voice (use with --force to redo existing files)
//   npm run gen-tts -w tools -- --samples        one line in a few voices → tools/data/tts-samples/
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allPhrases } from '../../client/src/examiner/phrases';
import type { Route } from '../../client/src/world/types';
import { ASSETS_DIR, DATA_DIR } from './env';

const MODEL = 'gemini-3.8-flash-tts';
const DEFAULT_VOICE = 'Charon';
const SAMPLE_VOICES = ['Charon', 'Iapetus', 'Kore'];
// In this layout the model takes the notes as direction and only speaks the transcript. A plain
// "Say this calmly: …" prefix gets read out loud.
const prompt = (text: string) =>
  `### DIRECTOR'S NOTES
Style: calm, clear, friendly UK driving examiner. Accent: neutral southern British (RP). Pace: unhurried.

### TRANSCRIPT
${text}`;
/** Silence kept before and after the words, and what counts as silence (16-bit samples). */
const PAD_S = 0.15;
const QUIET = 300;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');
const centre = process.env.CENTRE_ID ?? 'wanstead';

/**
 * One sentence as 16-bit mono PCM, and its sample rate. Now and then the model reads the director's notes
 * out too; that clip is far too long for the words, so it's thrown away and asked for again.
 */
async function tts(text: string, voice: string, tries = 3): Promise<{ pcm: Buffer; rate: number }> {
  const maxS = text.split(/\s+/).length / 1.5 + 1.5;
  for (let i = 1; ; i++) {
    const clip = await ttsOnce(text, voice);
    const seconds = clip.pcm.length / 2 / clip.rate;
    if (seconds <= maxS) return clip;
    if (i >= tries) throw new Error(`${MODEL}: "${text}" came back ${seconds.toFixed(1)} s long ${tries} times`);
    console.warn(`  ${seconds.toFixed(1)} s is too long for "${text}"; trying again`);
  }
}

async function ttsOnce(text: string, voice: string): Promise<{ pcm: Buffer; rate: number }> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey! },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt(text) }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`${MODEL}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as any;
  const data = body.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!data) throw new Error(`${MODEL}: no audio in reply: ${JSON.stringify(body).slice(0, 300)}`);
  const rate = Number(/rate=(\d+)/.exec(data.mimeType)?.[1] ?? 24000);
  return { pcm: trimSilence(Buffer.from(data.data, 'base64'), rate), rate };
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
function wav(pcm: Buffer, rate: number): Buffer {
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

/** A readable, stable file name: the start of the sentence plus a short hash of all of it. */
function fileName(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${slug}-${createHash('sha1').update(text).digest('hex').slice(0, 8)}.wav`;
}

if (flag('samples')) {
  const dir = resolve(DATA_DIR, 'tts-samples');
  mkdirSync(dir, { recursive: true });
  const line = 'At the roundabout, take the third exit.';
  for (const voice of SAMPLE_VOICES) {
    const { pcm, rate } = await tts(line, voice);
    writeFileSync(resolve(dir, `${voice}.wav`), wav(pcm, rate));
    console.log(`wrote ${voice}.wav`);
  }
  console.log(`Listen in ${dir}, then run with --voice <name> --force.`);
} else {
  const voice = option('voice') ?? DEFAULT_VOICE;
  const routeDir = resolve(ASSETS_DIR, centre);
  const phrases = new Set<string>();
  for (const f of readdirSync(routeDir).filter((n) => /^route-.*\.json$/.test(n))) {
    const route = JSON.parse(readFileSync(resolve(routeDir, f), 'utf8')) as Route;
    for (const p of allPhrases(route)) phrases.add(p);
  }

  const outDir = resolve(ASSETS_DIR, 'audio');
  mkdirSync(outDir, { recursive: true });
  const manifest: Record<string, string> = {};
  for (const text of phrases) {
    const name = fileName(text);
    const path = resolve(outDir, name);
    if (!existsSync(path) || flag('force')) {
      const { pcm, rate } = await tts(text, voice);
      writeFileSync(path, wav(pcm, rate));
      console.log(`${name}  (${(pcm.length / 2 / rate).toFixed(1)} s)  ${text}`);
    }
    manifest[text] = name;
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${phrases.size} sentences in assets/audio/manifest.json (voice ${voice})`);
}
