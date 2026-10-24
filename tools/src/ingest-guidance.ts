import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient, type Collection, type Document } from 'mongodb';
import { GUIDANCE_INDEX, GUIDANCE_TEXT_INDEX } from '../../server/src/debrief/retrieve';
import { ASSETS_DIR, DATA_DIR } from './env';
import { ruleText, sectionText } from './guidance/parse';
import { HIGHWAY_CODE, PAGES, RULE_PAGES, SECTIONS } from './guidance/sources';
import { tagRule } from './guidance/tags';

// DVSA + Highway Code pages → assets/guidance/chunks.json → guidance_chunks in Atlas, with an Automated
// Embedding (Voyage) vector index on `text`, an Atlas Search index on `title` and `text` for exact words
// ("mini-roundabout", "Rule 186"), both with `ruleIds` as a filter (SPEC §4.7 FR-D2, §7, §8).
//   npm run ingest-guidance -w tools              download pages (if not already) and write chunks.json
//   npm run ingest-guidance -w tools -- --fetch   download the pages again first
//   npm run ingest-guidance -w tools -- --push    also upsert into Atlas, make the indexes and try a search
const PAGE_DIR = resolve(DATA_DIR, 'guidance');
const OUT = resolve(ASSETS_DIR, 'guidance/chunks.json');
const INDEX_NAME = GUIDANCE_INDEX;
const TEXT_INDEX = GUIDANCE_TEXT_INDEX;
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
// Every rule on the pages: the hand-tagged ones as tagged, the rest by their words (rules no fault matches are left out).
const handTags = new Map(HIGHWAY_CODE.map((s) => [s.rule, s]));
for (const s of HIGHWAY_CODE) {
  if (!RULE_PAGES.some(([page, first, last]) => page === s.page && s.rule >= first && s.rule <= last)) {
    throw new Error(`Rule ${s.rule} is tagged by hand but isn't in RULE_PAGES`);
  }
}
for (const [page, first, last] of RULE_PAGES) {
  for (let rule = first; rule <= last; rule++) {
    const text = ruleText(html[page], rule);
    if (!text) throw new Error(`Rule ${rule} not found on ${PAGES[page].url}`);
    const ruleIds = handTags.get(rule)?.ruleIds ?? tagRule(text);
    if (!ruleIds.length) continue;
    chunks.push({
      _id: `hc-${rule}`,
      source: 'The Highway Code',
      url: `${PAGES[page].url}#rule${rule}`,
      title: `Highway Code Rule ${rule}`,
      text,
      ruleIds,
    });
  }
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

    await ensureIndex(col, INDEX_NAME, 'vectorSearch', {
      fields: [
        { type: 'autoEmbed', modality: 'text', path: 'text', model: MODEL },
        { type: 'filter', path: 'ruleIds' },
      ],
    });
    await ensureIndex(col, TEXT_INDEX, 'search', {
      mappings: {
        dynamic: false,
        fields: {
          title: { type: 'string', analyzer: 'lucene.english' },
          text: { type: 'string', analyzer: 'lucene.english' },
          ruleIds: { type: 'token' },
        },
      },
    });

    // Embedding happens in Atlas: wait until both indexes can be queried.
    for (const name of [INDEX_NAME, TEXT_INDEX]) {
      for (let i = 0; ; i++) {
        const [ix] = (await col.listSearchIndexes(name).toArray()) as IndexInfo[];
        if (ix?.queryable && ix.status === 'READY') break;
        if (i >= 60) throw new Error(`${name} still ${ix?.status} after 5 minutes`);
        if (i % 6 === 0) console.log(`waiting for ${name} (${ix?.status ?? 'missing'})…`);
        await new Promise((r) => setTimeout(r, 5000));
      }
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

/** Makes the index, or updates it if its definition changed. */
async function ensureIndex(col: Collection<Chunk>, name: string, type: 'search' | 'vectorSearch', definition: Document) {
  const [existing] = (await col.listSearchIndexes(name).toArray()) as IndexInfo[];
  if (!existing) {
    await col.createSearchIndex({ name, type, definition });
    console.log(`created ${name}`);
  } else if (JSON.stringify(existing.latestDefinition) !== JSON.stringify(definition)) {
    await col.updateSearchIndex(name, definition);
    console.log(`updated ${name}`);
  }
}
