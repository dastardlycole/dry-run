import { env } from './env';
import { buildApp } from './app';
import { closeDb, getDb } from './db';
import { ensureIndexes } from './sessions';

const app = buildApp(getDb, { logger: true });
app.addHook('onClose', closeDb);

await app.listen({ port: env.port, host: '0.0.0.0' });

// In the background: the API still starts (and the sim still drives) if Atlas can't be reached.
if (env.mongoUri) {
  getDb()
    .then(ensureIndexes)
    .then(() => app.log.info('fault_events indexes ready'))
    .catch((err) => app.log.error(err, 'could not create fault_events indexes'));
}
