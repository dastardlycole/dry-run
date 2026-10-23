import Fastify from 'fastify';
import { env } from './env';
import { closeDb, mongoStatus } from './db';

const app = Fastify({ logger: true });

app.get('/api/health', async () => ({
  ok: true,
  centreId: env.centreId,
  mongo: await mongoStatus(),
  gemini: env.geminiApiKey ? 'configured' : 'not configured',
}));

app.addHook('onClose', closeDb);

await app.listen({ port: env.port, host: '0.0.0.0' });
