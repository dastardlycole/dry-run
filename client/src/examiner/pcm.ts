// Audio in the shapes Gemini Live uses: it takes 16 kHz 16-bit mono PCM from the mic and sends back 24 kHz
// 16-bit mono PCM, both as base64. Plain functions, so they can be tested without a browser.

export const MIC_RATE = 16_000;
export const SPEAKER_RATE = 24_000;

/** Averages `input` (at `fromRate`) down to `toRate`. Mic audio is 44.1 or 48 kHz; Live wants 16 kHz. */
export function downsample(input: Float32Array, fromRate: number, toRate = MIC_RATE): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) throw new Error(`can't upsample ${fromRate} Hz to ${toRate} Hz`);
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    out[i] = sum / (b - a);
  }
  return out;
}

/** -1…1 floats → 16-bit little-endian samples, as base64. */
export function floatToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Base64 16-bit little-endian samples → -1…1 floats. */
export function pcm16Base64ToFloat(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}
