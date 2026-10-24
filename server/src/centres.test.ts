import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CentreInfo } from '../../tools/src/centre/finder';
import { buildApp } from './app';

// Typing a centre builds its map in the background; the page polls until it's ready.

const root = mkdtempSync(join(tmpdir(), 'dry-run-centres-'));
const assetsDir = join(root, 'assets');
const cacheDir = join(root, 'cache');
mkdirSync(join(assetsDir, 'wanstead'), { recursive: true });
for (const f of ['world', 'route-demo', 'route-auto-10', 'route-auto-2']) writeFileSync(join(assetsDir, 'wanstead', `${f}.json`), '{}');

const goodmayes: CentreInfo = { id: 'goodmayes', name: 'Goodmayes', address: '98 Goodmayes Road', postcode: 'IG3 9UZ', lat: 51.56, lng: 0.11 };
let finishBuild = () => {};
let builds = 0;
const app = buildApp(
  async () => {
    throw new Error('no database in this test');
  },
  {
    centres: {
      find: async (q) => (/goodmayes|ig3/i.test(q) ? goodmayes : /wanstead/i.test(q) ? { ...goodmayes, id: 'wanstead', name: 'Wanstead' } : null),
      build: (info, outDir, onProgress) => {
        builds++;
        onProgress({ step: 2, of: 4, label: 'Downloading parks and trees' });
        return new Promise((done) => {
          finishBuild = () => {
            mkdirSync(join(outDir, info.id), { recursive: true });
            writeFileSync(join(outDir, info.id, 'route-auto-1.json'), '{"id":"auto-1"}');
            writeFileSync(join(outDir, info.id, 'world.json'), '{"roads":[]}');
            done();
          };
        });
      },
      assetsDir,
      cacheDir,
    },
  },
);

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

const find = (q: string) => app.inject({ method: 'POST', url: '/api/centres/find', payload: { q } });

describe('finding and building a centre', () => {
  it('says a shipped centre is ready, with its routes in order', async () => {
    const res = await find('Wanstead');
    expect(res.json()).toMatchObject({ status: 'ready', base: '/wanstead', routes: ['demo', 'auto-2', 'auto-10'] });
  });

  it('builds a new centre in the background, once, until it is ready', async () => {
    const first = await find('IG3 9UZ');
    expect(first.json()).toMatchObject({ centre: { id: 'goodmayes', name: 'Goodmayes' }, status: 'building' });
    await find('goodmayes');
    expect((await app.inject({ url: '/api/centres/goodmayes' })).json()).toEqual({
      id: 'goodmayes',
      status: 'building',
      progress: { step: 2, of: 4, label: 'Downloading parks and trees' },
    });

    finishBuild();
    await new Promise((r) => setTimeout(r, 10));
    expect(builds).toBe(1);
    expect((await app.inject({ url: '/api/centres/goodmayes' })).json()).toEqual({
      id: 'goodmayes',
      status: 'ready',
      base: '/api/centres/goodmayes/files',
      routes: ['auto-1'],
    });
    const world = await app.inject({ url: '/api/centres/goodmayes/files/world.json' });
    expect(world.statusCode).toBe(200);
    expect(world.json()).toEqual({ roads: [] });
  });

  it('says plainly when nothing matches', async () => {
    const res = await find('zzzz');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('No driving test centre found');
  });

  it('only serves map files, never anything else on disk', async () => {
    for (const url of ['/api/centres/goodmayes/files/..%2F..%2Fsecret.json', '/api/centres/goodmayes/files/notes.txt', '/api/centres/..%2Fcache/files/world.json']) {
      expect((await app.inject({ url })).statusCode).toBe(404);
    }
    expect((await app.inject({ url: '/api/centres/nowhere' })).statusCode).toBe(404);
  });
});
