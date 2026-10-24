import Fastify from 'fastify';
import type { Db } from 'mongodb';
import { env } from './env';
import { mongoStatus } from './db';
import { Debriefer, type DebriefDeps } from './debrief/debriefer';
import { debriefRoutes } from './debrief/route';
import { SummaryVoice, summaryVoiceRoutes, type Speak } from './debrief/summary-voice';
import { junctionStatsRoutes } from './junction-stats';
import { liveTokenRoutes, type MintToken } from './live-token';
import { sessionRoutes } from './sessions';

/**
 * The API, given a way to reach the database (Atlas when running, an in-memory one in tests). Without
 * `debrief` (or `speak`, for the spoken summary, or `mintLiveToken`, for the 'tell me' question) there's no Gemini
 * (tests never call it by accident); index.ts passes the real ones.
 */
export function buildApp(
  getDb: () => Promise<Db>,
  opts: { logger?: boolean; debrief?: DebriefDeps; speak?: Speak; mintLiveToken?: MintToken } = {},
) {
  const app = Fastify({
    logger: opts.logger ?? false,
    // Refuse bodies with unknown fields instead of quietly dropping them.
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.get('/api/health', async () => ({
    ok: true,
    centreId: env.centreId,
    mongo: await mongoStatus(),
    gemini: env.geminiApiKey ? 'configured' : 'not configured',
  }));

  const debriefer = new Debriefer(getDb, opts.debrief ?? { findGuidance: () => async () => [], ai: null }, app.log);
  const voice = new SummaryVoice(debriefer, opts.speak ?? null, app.log);
  sessionRoutes(app, getDb, {
    faultsSaved: (events) => debriefer.faultsSaved(events),
    sessionEnded: (sessionId) => {
      debriefer.sessionEnded(sessionId);
      voice.sessionEnded(sessionId);
    },
  });
  junctionStatsRoutes(app, getDb);
  debriefRoutes(app, getDb, debriefer);
  summaryVoiceRoutes(app, voice);
  liveTokenRoutes(app, opts.mintLiveToken ?? null);
  return app;
}
