import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './env';
import { buildApp } from './app';
import { closeDb, getDb } from './db';
import { argonAI } from './debrief/argon';
import { hybridGuidance } from './debrief/retrieve';
import { geminiMint } from './live-token';
import { ensureIndexes } from './sessions';
import { DEFAULT_VOICE, tts, wav } from './tts';

// After `npm run build` the server also serves the game (how it runs when deployed); in dev, Vite does.
const clientDir = resolve(import.meta.dirname, '../../client/dist');

const app = buildApp(getDb, {
  logger: true,
  debrief: { findGuidance: hybridGuidance(), ai: env.geminiApiKey ? argonAI(env.geminiApiKey) : null },
  // Two tries, not three: the result screen waits 12 s (SUMMARY_AUDIO_WAIT_MS) before using the browser's voice.
  speak: env.geminiApiKey ? async (text) => wav(await tts(env.geminiApiKey, text, DEFAULT_VOICE, 2)) : undefined,
  mintLiveToken: env.geminiApiKey ? geminiMint(env.geminiApiKey) : undefined,
  clientDir: existsSync(clientDir) ? clientDir : undefined,
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
