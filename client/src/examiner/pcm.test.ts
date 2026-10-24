import { describe, expect, it } from 'vitest';
import { downsample, floatToPcm16Base64, pcm16Base64ToFloat } from './pcm';

describe('pcm', () => {
  it('averages 48 kHz down to 16 kHz', () => {
    const input = Float32Array.from([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1]);
    expect(Array.from(downsample(input, 48_000, 16_000))).toEqual([expect.closeTo(0.3), 1, -1]);
  });

  it('leaves audio already at the right rate alone, and refuses to upsample', () => {
    const input = Float32Array.from([0.1, 0.2]);
    expect(downsample(input, 16_000, 16_000)).toBe(input);
    expect(() => downsample(input, 8_000, 16_000)).toThrow();
  });

  it('round-trips through 16-bit base64, clipping out-of-range samples', () => {
    const back = pcm16Base64ToFloat(floatToPcm16Base64(Float32Array.from([0, 0.5, -0.5, 2, -2])));
    expect(back).toHaveLength(5);
    expect(back[0]).toBe(0);
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[2]).toBeCloseTo(-0.5, 3);
    expect(back[3]).toBeCloseTo(1, 3);
    expect(back[4]).toBe(-1);
  });

  it('writes little-endian 16-bit samples', () => {
    // -1 → 0x8000 → bytes 00 80.
    expect(atob(floatToPcm16Base64(Float32Array.from([-1])))).toBe('\x00\x80');
  });
});
