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
const centre = process.env.CENTRE_ID ?? 'wanstead';
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
      const clip = await tts(text, voice);
      writeFileSync(path, wav(clip));
      console.log(`${name}  (${(clip.pcm.length / 2 / clip.rate).toFixed(1)} s)  ${text}`);
    }
    manifest[text] = name;
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${phrases.size} sentences in assets/audio/manifest.json (voice ${voice})`);
}
