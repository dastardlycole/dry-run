import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { driveForces, msToMph, nextGear, steerAngle, type DriveInput, type Gear } from './controls';

// Car frame: +X forward, +Y up, +Z right (Rapier's default vehicle axes).
// UK car, so the driver sits on the right (+Z).
const HALF = { x: 2.0, y: 0.3, z: 0.875 }; // ~4.0 m × 1.75 m, like a Fiesta
const MASS = 1150;
const WHEEL_RADIUS = 0.3;
const SUSPENSION_REST = 0.35;
const WHEELS = [
  { x: 1.3, z: -0.75, front: true },
  { x: 1.3, z: 0.75, front: true },
  { x: -1.3, z: -0.75, front: false },
  { x: -1.3, z: 0.75, front: false },
];
const SPAWN_HEIGHT = 1.0;

/** Where the driver's eyes are, in the car frame. */
export const DRIVER_EYE = new THREE.Vector3(-0.15, 0.7, 0.37);
/** The interior mirror, in the car frame. */
export const MIRROR_POS = new THREE.Vector3(0.45, 0.78, 0);

export class Car {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh = new THREE.Group();
  gear: Gear = 'D';
  /** Signed speed along the car's forward axis, m/s. */
  speed = 0;
  private steer = 0;
  private prevInput: DriveInput = { throttle: false, brake: false, left: false, right: false, handbrake: false };
  private vehicle: RAPIER.DynamicRayCastVehicleController;
  private wheelMeshes: { pivot: THREE.Object3D; tyre: THREE.Object3D }[] = [];
  private start = { x: 0, z: 0, heading: 0 };

  constructor(private world: RAPIER.World, scene: THREE.Scene) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, SPAWN_HEIGHT, 0)
        .setCanSleep(false)
        // Building walls are thin, so stop a fast car stepping through one.
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.5),
    );
    // Low centre of mass so it doesn't roll over in turns.
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF.x, HALF.y, HALF.z)
        .setMassProperties(MASS, { x: 0, y: -0.35, z: 0 }, { x: 600, y: 1800, z: 1700 }, { x: 0, y: 0, z: 0, w: 1 })
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    this.vehicle = world.createVehicleController(this.body);
    WHEELS.forEach((w, i) => {
      this.vehicle.addWheel({ x: w.x, y: -0.1, z: w.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }, SUSPENSION_REST, WHEEL_RADIUS);
      this.vehicle.setWheelSuspensionStiffness(i, 30);
      this.vehicle.setWheelSuspensionCompression(i, 4.4);
      this.vehicle.setWheelSuspensionRelaxation(i, 2.3);
      this.vehicle.setWheelMaxSuspensionTravel(i, 0.3);
      this.vehicle.setWheelFrictionSlip(i, 2.0);
      this.vehicle.setWheelSideFrictionStiffness(i, 1.0);
    });

    this.buildMesh();
    scene.add(this.mesh);
  }

  private buildMesh() {
    const paint = new THREE.MeshLambertMaterial({ color: 0xcc2222 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x88aacc, transparent: true, opacity: 0.35 });

    // Lower body (its top is the bonnet you see from the driver's seat).
    const lower = new THREE.Mesh(new THREE.BoxGeometry(HALF.x * 2, 0.55, HALF.z * 2), paint);
    lower.position.y = -0.075;
    // Cabin. From inside, its faces are culled, so it doesn't block the first-person view.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.66, HALF.z * 2 - 0.1), glass);
    cabin.position.set(-0.4, 0.52, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, HALF.z * 2 - 0.1), paint);
    roof.position.set(-0.75, 0.9, 0);
    // Dashboard and steering wheel for the first-person view. No mirror mesh: from the driver's seat it
    // was a big dark block on the windscreen, and M shows the rear view on screen anyway.
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, HALF.z * 2 - 0.15), dark);
    dash.position.set(0.45, 0.26, 0);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 24), dark);
    wheel.position.set(0.2, 0.42, DRIVER_EYE.z);
    wheel.rotation.y = Math.PI / 2;
    wheel.rotation.x = 0.4;
    this.mesh.add(lower, cabin, roof, dash, wheel);

    const tyreGeom = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.22, 16);
    tyreGeom.rotateX(Math.PI / 2); // axle along Z
    const hubGeom = new THREE.BoxGeometry(0.3, 0.3, 0.23); // so you can see it spin
    const hubMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
    for (let i = 0; i < WHEELS.length; i++) {
      const pivot = new THREE.Object3D();
      const tyre = new THREE.Mesh(tyreGeom, dark);
      tyre.add(new THREE.Mesh(hubGeom, hubMat));
      pivot.add(tyre);
      this.mesh.add(pivot);
      this.wheelMeshes.push({ pivot, tyre });
    }
  }

  get speedMph() {
    return msToMph(this.speed);
  }

  /** Forward direction in world space. */
  forward(target = new THREE.Vector3()) {
    return target.set(1, 0, 0).applyQuaternion(this.mesh.quaternion);
  }

  /** Heading in radians, 0 = world +X, positive = turning left (counter-clockwise from above). */
  get heading() {
    const f = this.forward();
    return Math.atan2(-f.z, f.x);
  }

  /** Apply controls and advance the vehicle by one physics step. Call before world.step(). */
  update(input: DriveInput, dt: number) {
    this.speed = this.vehicle.currentVehicleSpeed();
    this.gear = nextGear(this.gear, input, this.prevInput, this.speed);
    this.prevInput = input;
    const f = driveForces(input, this.gear, this.speed);
    this.steer = steerAngle(this.steer, input, this.speed, dt);

    WHEELS.forEach((w, i) => {
      this.vehicle.setWheelSteering(i, w.front ? this.steer : 0);
      // Rapier pushes the car backwards for positive engine force with these axes, so flip it.
      this.vehicle.setWheelEngineForce(i, w.front ? 0 : -f.engine);
      this.vehicle.setWheelBrake(i, f.brake + (w.front ? 0 : f.handbrake));
    });
    this.vehicle.updateVehicle(dt);
  }

  /** Copy physics state onto the Three.js meshes. Call once per rendered frame. */
  sync() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    this.wheelMeshes.forEach(({ pivot, tyre }, i) => {
      const hard = this.vehicle.wheelChassisConnectionPointCs(i)!;
      const len = this.vehicle.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      pivot.position.set(hard.x, hard.y - len, hard.z);
      pivot.rotation.y = this.vehicle.wheelSteering(i) ?? 0;
      tyre.rotation.z = -(this.vehicle.wheelRotation(i) ?? 0);
    });
  }

  /** Where `reset` puts the car. `heading` is the rotation about +Y; 0 faces +X. */
  setStart(x: number, z: number, heading: number) {
    this.start = { x, z, heading };
  }

  reset() {
    const { x, z, heading } = this.start;
    this.body.setTranslation({ x, y: SPAWN_HEIGHT, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.gear = 'D';
    this.steer = 0;
    this.speed = 0;
  }
}
