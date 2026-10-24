import { createReadStream, existsSync, readdirSync, readFileSync, type ReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Route } from '../../client/src/world/types';
import type { CentreInfo } from '../../tools/src/centre/finder';

// Any test centre (SPEC §16, row 22). POST /api/centres/find turns what the learner typed into a DVSA centre
// and, if its map isn't built yet, builds it in the background (tools/src/centre-build.ts: OSM download,
// world, scenery, routes; about a minute). The page polls GET /api/centres/:id until it's ready. Centres
// committed in /assets are ready straight away; the rest are cached on disk and served from
// /api/centres/:id/files/. Only one build runs at a time, so Overpass isn't asked for two maps at once.

export type CentreStatus =
  | { id: string; status: 'ready'; base: string; routes: string[] }
  | { id: string; status: 'building'; progress?: BuildProgress }
  | { id: string; status: 'failed'; error: string };

/** Which stage a build is at (1-based), for the loading bar. */
export interface BuildProgress {
  step: number;
  of: number;
  label: string;
}

export interface CentresDeps {
  find: (text: string) => Promise<CentreInfo | null>;
  /** Builds the centre into `outDir`/<id>, saying which stage it's at as it goes. */
  build: (info: CentreInfo, outDir: string, onProgress: (p: BuildProgress) => void) => Promise<void>;
  /** Centres that ship with the game, served by the static files at /<id>/. */
  assetsDir: string;
  /** Where centres built on request are kept. */
  cacheDir: string;
}

const ID = /^[a-z0-9-]{1,60}$/;
const FILE = /^(world|scenery|route-[\w-]{1,40})\.json$/;

/** route-auto-2.json → auto-2, in number order (auto-10 after auto-9); the demo route first. */
export function routeIds(dir: string): string[] {
  const ids = readdirSync(dir).flatMap((f) => f.match(/^route-([\w-]+)\.json$/)?.[1] ?? []);
  const key = (id: string) => (id === 'demo' ? -1 : Number(id.match(/\d+$/)?.[0] ?? 1e9));
  return ids.sort((a, b) => key(a) - key(b) || a.localeCompare(b));
}

export class Centres {
  private building = new Map<string, Promise<void>>();
  private failed = new Map<string, string>();
  private progress = new Map<string, BuildProgress>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private deps: CentresDeps, private log: FastifyBaseLogger) {}

  status(id: string): CentreStatus | null {
    for (const [dir, base] of [[this.deps.assetsDir, `/${id}`], [this.deps.cacheDir, `/api/centres/${id}/files`]] as const) {
      const at = resolve(dir, id);
      if (existsSync(resolve(at, 'world.json'))) return { id, status: 'ready', base, routes: routeIds(at) };
    }
    if (this.building.has(id)) return { id, status: 'building', progress: this.progress.get(id) };
    const error = this.failed.get(id);
    return error ? { id, status: 'failed', error } : null;
  }

  /** Starts building the centre unless it's built or being built. */
  ensure(info: CentreInfo): CentreStatus {
    const now = this.status(info.id);
    if (now && now.status !== 'failed') return now;
    this.failed.delete(info.id);
    const job = this.queue.then(() => this.deps.build(info, this.deps.cacheDir, (p) => this.progress.set(info.id, p)));
    this.queue = job.catch(() => {});
    this.building.set(info.id, job);
    job
      .then(() => this.log.info(`built centre ${info.id}`))
      .catch((err: Error) => {
        this.log.error(err, `building centre ${info.id} failed`);
        this.failed.set(info.id, 'Sorry, the map for this centre could not be built. Try again, or another centre.');
      })
      .finally(() => {
        this.building.delete(info.id);
        this.progress.delete(info.id);
      });
    return { id: info.id, status: 'building' };
  }

  /** A built centre's file, or null. Streamed: world.json is megabytes. */
  file(id: string, file: string): ReadStream | null {
    if (!ID.test(id) || !FILE.test(file)) return null;
    const path = resolve(this.deps.cacheDir, id, file);
    return existsSync(path) ? createReadStream(path) : null;
  }

  find = (text: string) => this.deps.find(text);

  /** The parts of route files the server uses, by centre and route: they never change once built. */
  private routes = new Map<string, Pick<Route, 'lengthM' | 'steps'>>();

  /** A route's length and steps from its file (shipped or built), or undefined for a route it doesn't have. */
  route(id: string, routeId: string): Pick<Route, 'lengthM' | 'steps'> | undefined {
    if (!ID.test(id) || !FILE.test(`route-${routeId}.json`)) return undefined;
    const key = `${id}/${routeId}`;
    if (!this.routes.has(key)) {
      let route: Pick<Route, 'lengthM' | 'steps'> | null = null;
      for (const dir of [this.deps.assetsDir, this.deps.cacheDir]) {
        const path = resolve(dir, id, `route-${routeId}.json`);
        if (!existsSync(path)) continue;
        try {
          const { lengthM, steps } = JSON.parse(readFileSync(path, 'utf8')) as Route;
          route = { lengthM, steps: Array.isArray(steps) ? steps : [] };
        } catch (err) {
          this.log.warn(err, `route-${routeId}.json of ${id} could not be read`);
        }
        break;
      }
      // A route still being built isn't remembered as missing.
      if (route) this.routes.set(key, route);
    }
    return this.routes.get(key);
  }

  /**
   * How long a route is, from its own file, so the server sets the test's pass mark itself rather than
   * taking the client's word. Undefined for a route it doesn't have.
   */
  routeLengthM(id: string, routeId: string): number | undefined {
    const lengthM = this.route(id, routeId)?.lengthM;
    return typeof lengthM === 'number' && lengthM > 0 ? lengthM : undefined;
  }
}

export function centreRoutes(app: FastifyInstance, centres: Centres) {
  app.post<{ Body: { q: string } }>(
    '/api/centres/find',
    { schema: { body: { type: 'object', required: ['q'], additionalProperties: false, properties: { q: { type: 'string', maxLength: 100 } } } } },
    async (req, reply) => {
      const info = await centres.find(req.body.q).catch((err) => {
        req.log.warn(err, 'centre lookup failed');
        return null;
      });
      if (!info) return reply.code(404).send({ error: `No driving test centre found for "${req.body.q}". Try a full postcode.` });
      const { id, name, address, postcode } = info;
      return { centre: { id, name, address, postcode }, ...centres.ensure(info) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/centres/:id', async (req, reply) => {
    const s = ID.test(req.params.id) ? centres.status(req.params.id) : null;
    return s ?? reply.code(404).send({ error: 'unknown centre' });
  });

  app.get<{ Params: { id: string; file: string } }>('/api/centres/:id/files/:file', async (req, reply) => {
    const body = centres.file(req.params.id, req.params.file);
    if (body === null) return reply.code(404).send({ error: 'not found' });
    // Rebuilding a centre rewrites these, so don't keep them for long.
    return reply.type('application/json').header('cache-control', 'public, max-age=300').send(body);
  });
}
