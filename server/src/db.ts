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
  try {
    await (await getDb()).command({ ping: 1 });
    return 'up';
  } catch {
    return 'down';
  }
}

export async function closeDb() {
  await client?.close();
}
