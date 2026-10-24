import type { LiveConnectConfig, Tool } from '@google/genai';
import Fastify from 'fastify';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { TOOL_NAME, type LiveTicket } from '../../client/src/examiner/tell-me';
import { buildApp } from './app';
import { LIVE_MODEL, liveTokenRoutes, loadTellMe, type MintToken } from './live-token';

// GET /api/live-token with a fake token maker, so nothing here calls Gemini.

const noDb = async (): Promise<Db> => {
  throw new Error('no database in these tests');
};

describe('tell-me.json', () => {
  const file = loadTellMe();
  it('has the 14 official DVSA questions, each with an answer, and says where they came from', () => {
    expect(file.questions).toHaveLength(14);
    expect(new Set(file.questions.map((q) => q.id)).size).toBe(14);
    for (const q of file.questions) {
      expect(q.question).toMatch(/tell me/i);
      expect(q.answer.length).toBeGreaterThan(10);
      expect(q.topic).toBeTruthy();
    }
    expect(file.url).toMatch(/^https:\/\/www\.gov\.uk\//);
    expect(file.licence).toMatch(/Open Government Licence/);
  });
});

describe('GET /api/live-token', () => {
  it('answers 503 without Gemini, so the sim skips the question', async () => {
    const res = await buildApp(noDb).inject({ method: 'GET', url: '/api/live-token' });
    expect(res.statusCode).toBe(503);
  });

  it('locks the token to one question, its official answer, push-to-talk and the verdict tool', async () => {
    const calls: { model: string; config: LiveConnectConfig }[] = [];
    const mint: MintToken = async (model, config) => {
      calls.push({ model, config });
      return 'auth_tokens/fake';
    };
    const file = loadTellMe();
    const app = Fastify();
    // random() = 0.5 picks question 8 of 14 (index 7).
    liveTokenRoutes(app, mint, file, () => 0.5);
    const res = await app.inject({ method: 'GET', url: '/api/live-token' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const ticket = res.json() as LiveTicket;
    const q = file.questions[7];
    expect(ticket).toEqual({ token: 'auth_tokens/fake', model: LIVE_MODEL, question: q, source: { url: file.url, licence: file.licence } });

    expect(calls).toHaveLength(1);
    const { model, config } = calls[0];
    expect(model).toBe(LIVE_MODEL);
    expect(config.systemInstruction).toContain(q.question);
    expect(config.systemInstruction).toContain(q.answer);
    expect(config.realtimeInputConfig?.automaticActivityDetection?.disabled).toBe(true);
    const fn = (config.tools?.[0] as Tool | undefined)?.functionDeclarations?.[0];
    expect(fn?.name).toBe(TOOL_NAME);
    expect(fn?.parameters?.properties?.verdict?.enum).toEqual(['correct', 'incorrect']);
    expect(fn?.parameters?.required).toEqual(['verdict', 'reason']);
  });

  it("answers 502 when Gemini won't make a token", async () => {
    const app = Fastify();
    liveTokenRoutes(app, async () => {
      throw new Error('spending cap');
    });
    const res = await app.inject({ method: 'GET', url: '/api/live-token' });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('spending cap');
  });
});
