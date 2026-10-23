import { describe, expect, it } from 'vitest';
import {
  BRAKE,
  ENGINE_FORCE,
  HANDBRAKE,
  MAX_FORWARD_MS,
  MAX_STEER_RAD,
  driveForces,
  msToMph,
  nextGear,
  steerAngle,
  toggleIndicator,
  type DriveInput,
} from './controls';

const none: DriveInput = { throttle: false, brake: false, left: false, right: false, handbrake: false };
const input = (over: Partial<DriveInput>): DriveInput => ({ ...none, ...over });

describe('msToMph', () => {
  it('converts metres per second to mph', () => {
    expect(msToMph(0)).toBe(0);
    expect(msToMph(13.4112)).toBeCloseTo(30, 2);
  });
});

describe('toggleIndicator', () => {
  it('turns on, cancels and switches', () => {
    expect(toggleIndicator('off', 'left')).toBe('left');
    expect(toggleIndicator('left', 'left')).toBe('off');
    expect(toggleIndicator('left', 'right')).toBe('right');
    expect(toggleIndicator('right', 'right')).toBe('off');
  });
});

describe('nextGear', () => {
  it('goes into reverse on a fresh brake press at a stop', () => {
    expect(nextGear('D', input({ brake: true }), none, 0)).toBe('R');
  });
  it('stays in drive when the brake is kept down after stopping', () => {
    expect(nextGear('D', input({ brake: true }), input({ brake: true }), 0)).toBe('D');
  });
  it('stays in drive when braking while moving', () => {
    expect(nextGear('D', input({ brake: true }), none, 5)).toBe('D');
  });
  it('goes back to drive on a fresh throttle press at a stop', () => {
    expect(nextGear('R', input({ throttle: true }), none, -0.2)).toBe('D');
    expect(nextGear('R', input({ throttle: true }), input({ throttle: true }), -0.2)).toBe('R');
    expect(nextGear('R', input({ throttle: true }), none, -3)).toBe('R');
  });
});

describe('driveForces', () => {
  it('drives forwards in D', () => {
    expect(driveForces(input({ throttle: true }), 'D', 0)).toEqual({ engine: ENGINE_FORCE, brake: 0, handbrake: 0 });
  });
  it('drives backwards in R with the brake key', () => {
    expect(driveForces(input({ brake: true }), 'R', 0).engine).toBeLessThan(0);
  });
  it('brakes in R with the throttle key', () => {
    const f = driveForces(input({ throttle: true }), 'R', -2);
    expect(f.engine).toBe(0);
    expect(f.brake).toBe(BRAKE);
  });
  it('cuts the engine at the speed limit', () => {
    expect(driveForces(input({ throttle: true }), 'D', MAX_FORWARD_MS + 0.1).engine).toBe(0);
  });
  it('handbrake gives no drive and brakes the rear', () => {
    const f = driveForces(input({ throttle: true, handbrake: true }), 'D', 10);
    expect(f.engine).toBe(0);
    expect(f.handbrake).toBe(HANDBRAKE);
  });
});

describe('steerAngle', () => {
  it('turns toward full lock at standstill, positive is left', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = steerAngle(a, input({ left: true }), 0, 1 / 60);
    expect(a).toBeCloseTo(MAX_STEER_RAD);
  });
  it('gives less lock at speed', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = steerAngle(a, input({ right: true }), 20, 1 / 60);
    expect(a).toBeLessThan(0);
    expect(Math.abs(a)).toBeLessThan(MAX_STEER_RAD / 2);
  });
  it('returns to centre when released', () => {
    expect(steerAngle(0.01, none, 0, 1 / 60)).toBe(0);
  });
});
