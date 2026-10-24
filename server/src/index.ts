import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findCentre, locatePostcode } from '../../tools/src/centre/find';
import { findNear, type CentreInfo } from '../../tools/src/centre/finder';
import { env } from './env';
import { buildApp } from './app';
import type { BuildProgress } from './centres';
import { closeDb, getDb } from './db';
import { argonAI } from './debrief/argon';
import { hybridGuidance } from './debrief/retrieve';
import { geminiMint } from './live-token';
import { ensureIndexes } from './sessions';
import { DEFAULT_VOICE, tts, wav } from './tts';

// After `npm run build` the server also serves the game (how it runs when deployed); in dev, Vite does.
const clientDir = resolve(import.meta.dirname, '../../client/dist');
const repo = resolve(import.meta.dirname, '../..');
const centreList: CentreInfo[] = JSON.parse(readFileSync(resolve(repo, 'tools/src/centre/centres.json'), 'utf8'));

/** A build taking longer than this has stuck (OSM servers down): stop it so later centres aren't held up. */
const BUILD_LIMIT_MS = 4 * 60_000;

/** Builds a centre in its own process (the route search is heavy), so the server keeps answering meanwhile. */
const buildCentre = (info: CentreInfo, outDir: string, onProgress: (p: BuildProgress) => void) =>
  new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tools/src/centre-build.ts', '--out', outDir], {
      cwd: repo,
      env: { ...process.env, CENTRE_INFO: JSON.stringify(info) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    // Its log goes to ours; "@@step 2/4 Downloading parks and trees" lines move the loading bar.
    createInterface({ input: child.stdout }).on('line', (line) => {
      const m = line.match(/^@@step (\d+)\/(\d+) (.+)$/);
      if (m) onProgress({ step: +m[1], of: +m[2], label: m[3] });
      console.log(`[centre ${info.id}] ${line}`);
    });
    const timer = setTimeout(() => child.kill(), BUILD_LIMIT_MS);
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) done();
      else fail(new Error(signal ? `centre-build stopped after ${BUILD_LIMIT_MS / 1000} s` : `centre-build exited with ${code}`));
    });
  });

const app = buildApp(getDb, {
  logger: true,
  debrief: { findGuidance: hybridGuidance(), ai: env.geminiApiKey ? argonAI(env.geminiApiKey) : null },
  // Two tries, not three: the result screen waits 12 s (SUMMARY_AUDIO_WAIT_MS) before using the browser's voice.
  speak: env.geminiApiKey ? async (text) => wav(await tts(env.geminiApiKey, text, DEFAULT_VOICE, 2)) : undefined,
  mintLiveToken: env.geminiApiKey ? geminiMint(env.geminiApiKey) : undefined,
  clientDir: existsSync(clientDir) ? clientDir : undefined,
  centres: {
    find: (text) => findCentre(text, { centres: centreList, near: findNear, locate: locatePostcode }),
    build: buildCentre,
    // Built game files when deployed, the repo's /assets in dev: either way what's served at /<id>/.
    assetsDir: existsSync(clientDir) ? clientDir : resolve(repo, 'assets'),
    cacheDir: env.centreCacheDir || resolve(repo, 'tools/data/centres'),
  },
});
app.addHook('onClose', closeDb);
app.log.info(existsSync(clientDir) ? `serving the game from ${clientDir}` : 'no client build found; API only');

await app.listen({ port: env.port, host: '0.0.0.0' });

// In the background: the API still starts (and the sim still drives) if Atlas can't be reached.
if (env.mongoUri) {
  getDb()
    .then(ensureIndexes)
    .then(() => app.log.info('fault_events indexes ready'))
    .catch((err) => app.log.error(err, 'could not create fault_events indexes'));
}
