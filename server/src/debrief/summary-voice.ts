import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Debriefer } from './debriefer';

// The examiner's summary out loud, in the same Gemini TTS voice as the cached directions (SPEC §4.5 FR-E2).
// The summary is written on the fly, so its audio can't be made ahead: it's made as soon as the summary is,
// so it's usually ready by the time the result screen asks. Only a test's own checked summary is ever
// voiced; the endpoint never takes text, so it can't be used to spend our key on anything else.

/** Clips kept in memory: plenty for a demo, without growing forever. */
export const MAX_CLIPS = 50;

/** Text → WAV. */
export type Speak = (text: string) => Promise<Buffer>;

const id = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.:-]+$' };

export class SummaryVoice {
  private clips = new Map<string, Promise<Buffer | null>>();

  constructor(
    private debriefer: Debriefer,
    private speak: Speak | null,
    private log: FastifyBaseLogger,
  ) {}

  get available() {
    return this.speak !== null;
  }

  /** A test just ended: voice its summary once it's written. Returns at once. */
  sessionEnded(sessionId: string) {
    if (this.available) void this.clipFor(sessionId);
  }

  /** The summary as WAV; null when there's no summary (yet) or voicing failed. Never throws. */
  clipFor(sessionId: string): Promise<Buffer | null> {
    let p = this.clips.get(sessionId);
    if (!p) {
      const speak = this.speak;
      p = speak
        ? this.debriefer
            .finish(sessionId)
            .then((s) => (s ? speak(s.text) : null))
            .catch((err) => {
              this.log.warn({ err, sessionId }, 'summary voice failed');
              return null;
            })
        : Promise.resolve(null);
      const mine = p;
      this.clips.set(sessionId, mine);
      // Only real audio is kept: no summary yet, or a failed call, is worth asking again later.
      void mine.then((clip) => {
        if (!clip && this.clips.get(sessionId) === mine) this.clips.delete(sessionId);
      });
      if (this.clips.size > MAX_CLIPS) this.clips.delete(this.clips.keys().next().value!);
    }
    return p;
  }
}

export function summaryVoiceRoutes(app: FastifyInstance, voice: SummaryVoice) {
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/summary-audio',
    { schema: { params: { type: 'object', properties: { id } } } },
    async (req, reply) => {
      if (!voice.available) return reply.code(503).send({ error: 'no Gemini TTS on the server' });
      const clip = await voice.clipFor(req.params.id);
      if (!clip) return reply.code(404).send({ error: 'no summary to read out' });
      return reply.type('audio/wav').header('cache-control', 'no-store').send(clip);
    },
  );
}
