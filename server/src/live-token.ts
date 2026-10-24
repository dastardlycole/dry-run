import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleGenAI, Modality, Type, type LiveConnectConfig } from '@google/genai';
import type { FastifyInstance } from 'fastify';
import { TOOL_NAME, type LiveTicket, type TellMeFile, type TellMeQuestion } from '../../client/src/examiner/tell-me';
import { DEFAULT_VOICE } from './tts';

// GET /api/live-token (SPEC §4.5 FR-E3, §9): a one-use Gemini Live token for the 'tell me' question. The API key
// never leaves the server, and the token is locked to one question: the model, the examiner's instructions
// (with the official answer) and the verdict tool are fixed inside it, so the browser can't change them.

export const LIVE_MODEL = 'gemini-3.8-live';
/** The browser must open its Live session within this long of getting the token… */
const NEW_SESSION_S = 60;
/** …and the whole question is over well before this. */
const SESSION_S = 5 * 60;

const TELL_ME_FILE = resolve(import.meta.dirname, '../../assets/guidance/tell-me.json');
export const loadTellMe = (): TellMeFile => JSON.parse(readFileSync(TELL_ME_FILE, 'utf8'));

/** What the examiner is told. The verdict is the model's; the fault it leads to is logged by the sim's code. */
export function instructions(q: TellMeQuestion): string {
  return `You are a calm, friendly UK driving examiner (DVSA) at Wanstead driving test centre in London. Speak British English, briefly.
The learner is sitting in the car, about to start their driving test. You ask them one 'tell me' vehicle safety question.

1. When the learner says they're ready, ask this question word for word and say nothing else: "${q.question}"
2. Wait for their answer. Don't hint or help.
3. Compare their answer with the official DVSA answer below. It's correct if it covers the main point of the official answer in their own words; it doesn't need to be word for word or mention every detail. It's incorrect if it's wrong, misses the main point, or they don't know.
4. If you couldn't hear an answer, or it was cut off, say "Sorry, could you say that again?" once, and wait.
5. Then call ${TOOL_NAME} exactly once.
6. After the call, say one short sentence: if correct, "That's correct, thank you." If incorrect, say in a few words what the official answer is. Then stop. Never comment on their driving.

Official DVSA answer: "${q.answer}"`;
}

export function liveConfig(q: TellMeQuestion): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: instructions(q),
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: DEFAULT_VOICE } } },
    // Push-to-talk: the browser says when the learner starts and stops (holding T), instead of Gemini guessing.
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    // Words for the card: what the learner said, and what the examiner said.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [
      {
        functionDeclarations: [
          {
            name: TOOL_NAME,
            description: "Records whether the learner's spoken answer matches the official DVSA answer.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                verdict: { type: Type.STRING, enum: ['correct', 'incorrect'] },
                reason: { type: Type.STRING, description: 'One short sentence to the learner: what they got right, or what was missing. Under 25 words.' },
              },
              required: ['verdict', 'reason'],
            },
          },
        ],
      },
    ],
  };
}

/** Makes a token for `config` on `model`. Tests pass a fake; index.ts passes geminiMint. */
export type MintToken = (model: string, config: LiveConnectConfig) => Promise<string>;

export function geminiMint(apiKey: string): MintToken {
  // Ephemeral tokens are only on v1alpha.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  return async (model, config) => {
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + SESSION_S * 1000).toISOString(),
        newSessionExpireTime: new Date(now + NEW_SESSION_S * 1000).toISOString(),
        // With constraints and no lockAdditionalFields, every field is locked: the browser can't change any of
        // them. (An empty lockAdditionalFields builds a field mask Gemini refuses for this config.)
        liveConnectConstraints: { model, config },
        httpOptions: { apiVersion: 'v1alpha', timeout: 5000 },
      },
    });
    if (!token.name) throw new Error('Gemini returned no token');
    return token.name;
  };
}

/** Without `mint` (no Gemini key) it answers 503 and the sim skips the question. */
export function liveTokenRoutes(app: FastifyInstance, mint: MintToken | null, file: TellMeFile = loadTellMe(), random = Math.random) {
  app.get('/api/live-token', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    if (!mint) return reply.code(503).send({ error: 'Gemini is not set up on the server' });
    const question = file.questions[Math.floor(random() * file.questions.length)];
    try {
      const token = await mint(LIVE_MODEL, liveConfig(question));
      const ticket: LiveTicket = { token, model: LIVE_MODEL, question, source: { url: file.url, licence: file.licence } };
      return ticket;
    } catch (err) {
      app.log.warn({ err }, 'live-token: could not make a token');
      return reply.code(502).send({ error: 'Could not get a Gemini Live token' });
    }
  });
}
