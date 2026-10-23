// Pure driving logic: no Three.js or Rapier here, so it can be unit tested.

export type Indicator = 'off' | 'left' | 'right';
export type Gear = 'D' | 'R';

export interface DriveInput {
  throttle: boolean; // W / Up
  brake: boolean; // S / Down
  left: boolean; // A / Left
  right: boolean; // D / Right
  handbrake: boolean; // Space
}

export interface DriveForces {
  engine: number; // N per driven wheel; positive = forwards
  brake: number; // brake impulse per wheel (all four)
  handbrake: number; // extra brake on the rear wheels
}

export const MPH_PER_MS = 2.23694;
export const MAX_FORWARD_MS = 70 / MPH_PER_MS;
export const MAX_REVERSE_MS = 10 / MPH_PER_MS;
const STOPPED_MS = 0.5;

// Tuning for a ~1150 kg car. Brake values are per-step impulses (Rapier/Bullet style).
export const ENGINE_FORCE = 1800;
export const BRAKE = 30;
export const COAST_BRAKE = 1.5;
export const HANDBRAKE = 80;

export const MAX_STEER_RAD = 0.6;
const STEER_RATE = 2.5; // rad/s the front wheels turn at
const STEER_SPEED_FALLOFF = 12; // m/s; higher speed → less lock

export function msToMph(ms: number): number {
  return ms * MPH_PER_MS;
}

/** Z = left, X = right. Pressing the active side again cancels; the other side switches. */
export function toggleIndicator(current: Indicator, pressed: 'left' | 'right'): Indicator {
  return current === pressed ? 'off' : pressed;
}

/**
 * Press brake while stopped → reverse. Press throttle while stopped → drive.
 * It must be a fresh press (not held on the previous step), so braking to a stop
 * and keeping the pedal down holds the car still instead of reversing.
 * `speed` is signed along the car's forward axis (m/s).
 */
export function nextGear(gear: Gear, input: DriveInput, prev: DriveInput, speed: number): Gear {
  if (Math.abs(speed) > STOPPED_MS) return gear;
  if (gear === 'D' && input.brake && !prev.brake && !input.throttle) return 'R';
  if (gear === 'R' && input.throttle && !prev.throttle && !input.brake) return 'D';
  return gear;
}

export function driveForces(input: DriveInput, gear: Gear, speed: number): DriveForces {
  // In reverse the pedals swap: S pushes backwards, W brakes.
  const go = gear === 'D' ? input.throttle : input.brake;
  const stop = gear === 'D' ? input.brake : input.throttle;
  const atLimit = gear === 'D' ? speed >= MAX_FORWARD_MS : speed <= -MAX_REVERSE_MS;

  let engine = 0;
  if (go && !stop && !input.handbrake && !atLimit) engine = gear === 'D' ? ENGINE_FORCE : -ENGINE_FORCE * 0.6;

  return {
    engine,
    brake: stop ? BRAKE : engine === 0 ? COAST_BRAKE : 0,
    handbrake: input.handbrake ? HANDBRAKE : 0,
  };
}

/** Smoothly moves the steering angle toward the target. Positive = left. Less lock at speed. */
export function steerAngle(current: number, input: DriveInput, speed: number, dt: number): number {
  const dir = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const maxSteer = MAX_STEER_RAD / (1 + Math.abs(speed) / STEER_SPEED_FALLOFF);
  const target = dir * maxSteer;
  const step = STEER_RATE * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}
