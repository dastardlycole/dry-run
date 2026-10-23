import Fastify from 'fastify';
import type { Db } from 'mongodb';
import { env } from './env';
import { mongoStatus } from './db';
import { Debriefer, type DebriefDeps } from './debrief/debriefer';
import { debriefRoutes } from './debrief/route';
import { junctionStatsRoutes } from './junction-stats';
import { sessionRoutes } from './sessions';

/**
 * The API, given a way to reach the database (Atlas when running, an in-memory one in tests). Without
 * `debrief` there's no Gemini (tests never call it by accident); index.ts passes the real one.
 */
export function buildApp(getDb: () => Promise<Db>, opts: { logger?: boolean; debrief?: DebriefDeps } = {}) {
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
  sessionRoutes(app, getDb, {
    faultsSaved: (events) => debriefer.faultsSaved(events),
    sessionEnded: (sessionId) => debriefer.sessionEnded(sessionId),
  });
  junctionStatsRoutes(app, getDb);
  debriefRoutes(app, getDb, debriefer);
  return app;
}
