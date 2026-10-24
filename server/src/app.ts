import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Db } from 'mongodb';
import { env } from './env';
import { Centres, centreRoutes, type CentresDeps } from './centres';
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
 * (tests never call it by accident); index.ts passes the real ones, and `centres` (finding and building any test
 * centre). With `clientDir` (the built client, when
 * deployed) the same server also serves the game itself, so one https link has both.
 */
export function buildApp(
  getDb: () => Promise<Db>,
  opts: {
    logger?: boolean;
    debrief?: DebriefDeps;
    speak?: Speak;
    mintLiveToken?: MintToken;
    clientDir?: string;
    centres?: CentresDeps;
  } = {},
) {
  const app = Fastify({
    logger: opts.logger ?? false,
    // Refuse bodies with unknown fields instead of quietly dropping them.
    ajv: { customOptions: { removeAdditional: false } },
  });

  // The map JSON is megabytes, so compress it (registered first, so it covers every route).
  app.register(fastifyCompress);

  app.get('/api/health', async () => ({
    ok: true,
    centreId: env.centreId,
    mongo: await mongoStatus(),
    gemini: env.geminiApiKey ? 'configured' : 'not configured',
  }));

  const debriefer = new Debriefer(getDb, opts.debrief ?? { findGuidance: () => async () => [], ai: null }, app.log);
  const voice = new SummaryVoice(debriefer, opts.speak ?? null, app.log);
  const centres = opts.centres ? new Centres(opts.centres, app.log) : null;
  sessionRoutes(app, getDb, {
    routeLengthM: (centreId, routeId) => centres?.routeLengthM(centreId, routeId),
    routeSteps: (centreId, routeId) => centres?.route(centreId, routeId)?.steps,
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
  if (centres) centreRoutes(app, centres);
  if (opts.clientDir) {
    // Vite's /assets/ files have hashed names and never change.
    app.register(fastifyStatic, {
      root: opts.clientDir,
      extensions: ['html'], // /instructor as well as /instructor.html
      setHeaders: (reply) => {
        if (reply.request.url.startsWith('/assets/')) reply.header('cache-control', 'public, max-age=31536000, immutable');
      },
    });
  }
  return app;
}
