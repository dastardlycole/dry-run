import { describe, expect, it } from 'vitest';
import { Input } from './input';

const key = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });

describe('Input.takeMirrorCheck', () => {
  const setup = () => {
    const target = new EventTarget();
    return { target, input: new Input(target as unknown as Window) };
  };

  it('is false before any mirror check', () => {
    expect(setup().input.takeMirrorCheck()).toBe(false);
  });

  it('is true every frame while M is held, and stops when it is let go', () => {
    const { target, input } = setup();
    target.dispatchEvent(key('keydown', 'KeyM'));
    expect(input.takeMirrorCheck()).toBe(true);
    expect(input.takeMirrorCheck()).toBe(true);
    target.dispatchEvent(key('keyup', 'KeyM'));
    expect(input.takeMirrorCheck()).toBe(false);
  });

  it('counts a quick tap that starts and ends between two frames, once', () => {
    const { target, input } = setup();
    target.dispatchEvent(key('keydown', 'KeyM'));
    target.dispatchEvent(key('keyup', 'KeyM'));
    expect(input.takeMirrorCheck()).toBe(true);
    expect(input.takeMirrorCheck()).toBe(false);
  });

  it('lets go of M if the window loses focus', () => {
    const { target, input } = setup();
    target.dispatchEvent(key('keydown', 'KeyM'));
    input.takeMirrorCheck();
    target.dispatchEvent(new Event('blur'));
    expect(input.takeMirrorCheck()).toBe(false);
  });
});

describe('Input.takeLooks', () => {
  const setup = () => {
    const target = new EventTarget();
    return { target, input: new Input(target as unknown as Window) };
  };

  it('is true for each side while Q or E is held', () => {
    const { target, input } = setup();
    expect(input.takeLooks()).toEqual({ lookLeft: false, lookRight: false });
    target.dispatchEvent(key('keydown', 'KeyE'));
    expect(input.takeLooks()).toEqual({ lookLeft: false, lookRight: true });
    target.dispatchEvent(key('keyup', 'KeyE'));
    target.dispatchEvent(key('keydown', 'KeyQ'));
    expect(input.takeLooks()).toEqual({ lookLeft: true, lookRight: false });
  });

  it('counts a quick tap that starts and ends between two frames, once', () => {
    const { target, input } = setup();
    target.dispatchEvent(key('keydown', 'KeyQ'));
    target.dispatchEvent(key('keyup', 'KeyQ'));
    target.dispatchEvent(key('keydown', 'KeyE'));
    target.dispatchEvent(key('keyup', 'KeyE'));
    expect(input.takeLooks()).toEqual({ lookLeft: true, lookRight: true });
    expect(input.takeLooks()).toEqual({ lookLeft: false, lookRight: false });
  });
});
