import { MongoClient, type Db } from 'mongodb';
import { env } from './env';

let client: MongoClient | undefined;

export async function getDb(): Promise<Db> {
  if (!env.mongoUri) throw new Error('MONGODB_URI not set');
  if (!client) {
    client = new MongoClient(env.mongoUri, { appName: 'dry-run' });
    await client.connect();
  }
  return client.db(env.mongoDb);
}

export async function mongoStatus(): Promise<'up' | 'down' | 'not configured'> {
  if (!env.mongoUri) return 'not configured';
  // Capped, so a slow or blocked Atlas never stalls /api/health (the deploy's health check).
  let timer: NodeJS.Timeout | undefined;
  const tooSlow = new Promise<'down'>((done) => (timer = setTimeout(() => done('down'), 2000)));
  const ping = getDb()
    .then((db) => db.command({ ping: 1 }))
    .then(() => 'up' as const, () => 'down' as const);
  try {
    return await Promise.race([ping, tooSlow]);
  } finally {
    clearTimeout(timer);
  }
}

export async function closeDb() {
  await client?.close();
}
