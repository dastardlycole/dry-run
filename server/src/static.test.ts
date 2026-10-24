import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';

// When deployed, one server serves both the built game and the API.

const dir = mkdtempSync(join(tmpdir(), 'dry-run-client-'));
writeFileSync(join(dir, 'index.html'), '<title>Dry Run</title>');
writeFileSync(join(dir, 'instructor.html'), '<title>Instructor</title>');
mkdirSync(join(dir, 'assets'));
writeFileSync(join(dir, 'assets', 'sim-abc123.js'), 'console.log(1)');
mkdirSync(join(dir, 'wanstead'));
writeFileSync(join(dir, 'wanstead', 'world.json'), '{"roads":[]}');
const app = buildApp(async () => {
  throw new Error('no database in this test');
}, { clientDir: dir });

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('serving the built client', () => {
  it('sends the game page at /', async () => {
    const res = await app.inject({ url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Dry Run');
  });

  it('sends the map files', async () => {
    const res = await app.inject({ url: '/wanstead/world.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ roads: [] });
  });

  it('still answers the API instead of looking for a file', async () => {
    // No Gemini in tests, so the route answers 503; a 404 would mean the static files swallowed /api.
    const res = await app.inject({ url: '/api/live-token' });
    expect(res.statusCode).toBe(503);
  });

  it('sends the instructor page without .html', async () => {
    const res = await app.inject({ url: '/instructor' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Instructor');
  });

  it('lets browsers keep the hashed build files, but not the page', async () => {
    const js = await app.inject({ url: '/assets/sim-abc123.js' });
    expect(js.headers['cache-control']).toContain('immutable');
    const page = await app.inject({ url: '/' });
    expect(page.headers['cache-control']).not.toContain('immutable');
  });

  it('compresses when the browser allows it', async () => {
    const res = await app.inject({ url: '/wanstead/world.json', headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('gives an unknown API path a JSON 404, not the game page', async () => {
    const res = await app.inject({ url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('says 404 for a file that is not there', async () => {
    const res = await app.inject({ url: '/nope.js' });
    expect(res.statusCode).toBe(404);
  });
});
