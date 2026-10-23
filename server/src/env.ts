import { config } from 'dotenv';
import { resolve } from 'node:path';

// .env lives at the repo root, shared by server and tools.
config({ path: resolve(import.meta.dirname, '../../.env') });

export const env = {
  port: Number(process.env.PORT ?? 3000),
  mongoUri: process.env.MONGODB_URI ?? '',
  mongoDb: process.env.MONGODB_DB ?? 'dryrun',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  centreId: process.env.CENTRE_ID ?? 'wanstead',
  demoMode: process.env.DEMO_MODE === 'true',
};
