import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from './input';

const key = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });

describe('Input.lastMirrorAt', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = () => {
    const target = new EventTarget();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const input = new Input(target as unknown as Window);
    return { target, input, at: (t: number) => (now = t) };
  };

  it('is -Infinity before any mirror check', () => {
    expect(setup().input.lastMirrorAt).toBe(-Infinity);
  });

  it('counts a long hold up to when M is let go', () => {
    const { target, input, at } = setup();
    at(1000);
    target.dispatchEvent(key('keydown', 'KeyM'));
    at(4000);
    expect(input.lastMirrorAt).toBe(4000); // still holding
    target.dispatchEvent(key('keyup', 'KeyM'));
    at(5000);
    expect(input.lastMirrorAt).toBe(4000);
  });

  it('records the time if the window loses focus while M is held', () => {
    const { target, input, at } = setup();
    at(1000);
    target.dispatchEvent(key('keydown', 'KeyM'));
    at(2500);
    target.dispatchEvent(new Event('blur'));
    at(9000);
    expect(input.lastMirrorAt).toBe(2500);
  });
});
