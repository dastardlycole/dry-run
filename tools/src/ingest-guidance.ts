import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { ASSETS_DIR, DATA_DIR } from './env';
import { ruleText, sectionText } from './guidance/parse';
import { HIGHWAY_CODE, PAGES, SECTIONS } from './guidance/sources';

// DVSA + Highway Code pages → assets/guidance/chunks.json → guidance_chunks in Atlas, with an Automated
// Embedding (Voyage) vector index on `text` and `ruleIds` as a filter (SPEC §4.7 FR-D2, §7, §8).
//   npm run ingest-guidance -w tools              download pages (if not already) and write chunks.json
//   npm run ingest-guidance -w tools -- --fetch   download the pages again first
//   npm run ingest-guidance -w tools -- --push    also upsert into Atlas, make the index and try a search
const PAGE_DIR = resolve(DATA_DIR, 'guidance');
const OUT = resolve(ASSETS_DIR, 'guidance/chunks.json');
const INDEX_NAME = 'guidance_vector';
const MODEL = 'voyage-4';

const args = process.argv.slice(2);

/** What listSearchIndexes reports about an index (the driver types it loosely). */
interface IndexInfo {
  status?: string;
  queryable?: boolean;
  latestDefinition?: unknown;
}

interface Chunk {
  _id: string;
  source: string;
  url: string;
  title: string;
  text: string;
  ruleIds: string[];
}

mkdirSync(PAGE_DIR, { recursive: true });
const html: Record<string, string> = {};
for (const [key, page] of Object.entries(PAGES)) {
  const file = resolve(PAGE_DIR, page.file);
  if (args.includes('--fetch') || !existsSync(file)) {
    const res = await fetch(page.url);
    if (!res.ok) throw new Error(`${page.url}: HTTP ${res.status}`);
    writeFileSync(file, await res.text());
    console.log(`downloaded ${page.url}`);
  }
  html[key] = readFileSync(file, 'utf8');
}

const chunks: Chunk[] = [];
for (const s of HIGHWAY_CODE) {
  const text = ruleText(html[s.page], s.rule);
  if (!text) throw new Error(`Rule ${s.rule} not found on ${PAGES[s.page].url}`);
  chunks.push({
    _id: `hc-${s.rule}`,
    source: 'The Highway Code',
    url: `${PAGES[s.page].url}#rule${s.rule}`,
    title: `Highway Code Rule ${s.rule}`,
    text,
    ruleIds: s.ruleIds,
  });
}
for (const s of SECTIONS) {
  const text = sectionText(html[s.page], s.from, s.toId);
  if (!text) throw new Error(`Section ${s.id} not found on ${PAGES[s.page].url}`);
  chunks.push({ _id: s.id, source: 'DVSA', url: PAGES[s.page].url, title: s.title, text, ruleIds: s.ruleIds });
}

mkdirSync(resolve(OUT, '..'), { recursive: true });
writeFileSync(OUT, JSON.stringify(chunks, null, 2) + '\n');
console.log(`${chunks.length} chunks → ${OUT}`);

if (args.includes('--push')) await push(chunks);

async function push(chunks: Chunk[]) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');
  const client = await MongoClient.connect(uri, { appName: 'dry-run-ingest-guidance' });
  try {
    const col = client.db(process.env.MONGODB_DB ?? 'dryrun').collection<Chunk>('guidance_chunks');
    await col.bulkWrite(chunks.map((c) => ({ replaceOne: { filter: { _id: c._id }, replacement: c, upsert: true } })));
    const gone = await col.deleteMany({ _id: { $nin: chunks.map((c) => c._id) } });
    console.log(`guidance_chunks: ${chunks.length} upserted, ${gone.deletedCount} old ones removed`);

    const definition = {
      fields: [
        { type: 'autoEmbed', modality: 'text', path: 'text', model: MODEL },
        { type: 'filter', path: 'ruleIds' },
      ],
    };
    const existing = (await col.listSearchIndexes(INDEX_NAME).toArray()) as IndexInfo[];
    if (!existing.length) {
      await col.createSearchIndex({ name: INDEX_NAME, type: 'vectorSearch', definition });
      console.log(`created ${INDEX_NAME}`);
    } else if (JSON.stringify(existing[0].latestDefinition) !== JSON.stringify(definition)) {
      await col.updateSearchIndex(INDEX_NAME, definition);
      console.log(`updated ${INDEX_NAME}`);
    }

    // Embedding happens in Atlas: wait until the index can be queried.
    for (let i = 0; ; i++) {
      const [ix] = (await col.listSearchIndexes(INDEX_NAME).toArray()) as IndexInfo[];
      if (ix?.queryable && ix.status === 'READY') break;
      if (i >= 60) throw new Error(`${INDEX_NAME} still ${ix?.status} after 5 minutes`);
      if (i % 6 === 0) console.log(`waiting for ${INDEX_NAME} (${ix?.status ?? 'missing'})…`);
      await new Promise((r) => setTimeout(r, 5000));
    }

    const hits = await col
      .aggregate([
        {
          $vectorSearch: {
            index: INDEX_NAME,
            path: 'text',
            query: { text: 'I signalled right on the roundabout but was in the left lane' },
            filter: { ruleIds: 'R9' },
            numCandidates: 50,
            limit: 3,
          },
        },
        { $project: { title: 1, score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray();
    console.log('test search (R9):', hits.map((h) => `${h.title} ${Number(h.score).toFixed(3)}`).join(' · '));
  } finally {
    await client.close();
  }
}
