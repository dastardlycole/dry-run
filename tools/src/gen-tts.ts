// Pre-generates the examiner's sentences as audio with Gemini TTS (SPEC §4.5 FR-E1), so the sim never
// waits on the network to speak. Writes assets/audio/*.wav and assets/audio/manifest.json
// (sentence → file). Sentences come from the same code the sim uses (client/src/examiner/phrases.ts
// everyPhrase): a fixed set with no road names, so it covers every centre and route. Files that already
// exist are kept unless --force; files no longer in the set are deleted.
//
//   npm run gen-tts -w tools                     all sentences, default voice
//   npm run gen-tts -w tools -- --voice Kore     another voice (use with --force to redo existing files)
//   npm run gen-tts -w tools -- --samples        one line in a few voices → tools/data/tts-samples/
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { everyPhrase } from '../../client/src/examiner/phrases';
import { DEFAULT_VOICE, tts as speak, wav } from '../../server/src/tts';
import { ASSETS_DIR, DATA_DIR } from './env';

const SAMPLE_VOICES = ['Charon', 'Iapetus', 'Kore'];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');
const tts = (text: string, voice: string) => speak(apiKey, text, voice);

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
    writeFileSync(resolve(dir, `${voice}.wav`), wav(await tts(line, voice)));
    console.log(`wrote ${voice}.wav`);
  }
  console.log(`Listen in ${dir}, then run with --voice <name> --force.`);
} else {
  const voice = option('voice') ?? DEFAULT_VOICE;
  const phrases = new Set(everyPhrase());

  const outDir = resolve(ASSETS_DIR, 'audio');
  mkdirSync(outDir, { recursive: true });
  const manifest: Record<string, string> = {};
  for (const text of phrases) {
    const name = fileName(text);
    const path = resolve(outDir, name);
    if (!existsSync(path) || flag('force')) {
      const clip = await tts(text, voice);
      writeFileSync(path, wav(clip));
      console.log(`${name}  (${(clip.pcm.length / 2 / clip.rate).toFixed(1)} s)  ${text}`);
    }
    manifest[text] = name;
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const keep = new Set(Object.values(manifest));
  for (const f of readdirSync(outDir)) if (f.endsWith('.wav') && !keep.has(f)) rmSync(resolve(outDir, f));
  console.log(`${phrases.size} sentences in assets/audio/manifest.json (voice ${voice})`);
}
