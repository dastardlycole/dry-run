import { describe, expect, it } from 'vitest';
import { Contacts } from './contacts';

describe('Contacts', () => {
  it('reports a hit that started and ended between two frames', () => {
    const c = new Contacts();
    c.start(7, 'parkedCar');
    c.stop(7);
    expect(c.take()).toBe('parkedCar');
    expect(c.take()).toBeNull();
  });

  it('keeps reporting while the car stays touching', () => {
    const c = new Contacts();
    c.start(7, 'building');
    expect(c.take()).toBe('building');
    expect(c.take()).toBe('building');
    c.stop(7);
    expect(c.take()).toBeNull();
  });

  it('forgets everything on clear', () => {
    const c = new Contacts();
    c.start(7, 'building');
    c.clear();
    expect(c.take()).toBeNull();
  });
});
