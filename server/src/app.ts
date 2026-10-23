import Fastify from 'fastify';
import type { Db } from 'mongodb';
import { env } from './env';
import { mongoStatus } from './db';
import { sessionRoutes } from './sessions';

/** The API, given a way to reach the database (Atlas when running, an in-memory one in tests). */
export function buildApp(getDb: () => Promise<Db>, opts: { logger?: boolean } = {}) {
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

  sessionRoutes(app, getDb);
  return app;
}
