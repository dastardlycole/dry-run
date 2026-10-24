// The examiner's summary as audio, from GET /api/sessions/:id/summary-audio (Gemini TTS, made on the server as
// soon as the summary is written). Gives up after a few seconds so the browser's voice can say it instead.

/** How long to wait for the audio before falling back to the browser's voice. */
export const SUMMARY_AUDIO_WAIT_MS = 12_000;

/** The WAV, or null if it isn't there in time (or at all). Never throws. */
export async function fetchSummaryAudio(sessionId: string, signal: AbortSignal, waitMs = SUMMARY_AUDIO_WAIT_MS): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/summary-audio`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(waitMs)]),
    });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
