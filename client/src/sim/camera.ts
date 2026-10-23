import * as THREE from 'three';
import { DRIVER_EYE, MIRROR_POS, type Car } from './car';

export type CameraMode = 'driver' | 'chase';

const LOOK_YAW = THREE.MathUtils.degToRad(75); // Q/E head turn
const HEAD_RATE = 8; // how fast the head turns (higher = snappier)
// Head turn needed to look from the driver's eyes at the interior mirror (up and to the left).
const MIRROR_YAW = Math.atan2(DRIVER_EYE.z - MIRROR_POS.z, MIRROR_POS.x - DRIVER_EYE.x);
const MIRROR_PITCH = Math.atan2(
  MIRROR_POS.y - DRIVER_EYE.y,
  Math.hypot(MIRROR_POS.x - DRIVER_EYE.x, MIRROR_POS.z - DRIVER_EYE.z),
);

// Three.js cameras look down -Z; the car faces +X. Turning by -90° lines them up.
const FACE_FORWARD = -Math.PI / 2;

export interface HeadInput {
  lookLeft: boolean;
  lookRight: boolean;
  mirror: boolean;
}

export class Cameras {
  mode: CameraMode = 'driver';
  readonly main = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
  private rear = new THREE.PerspectiveCamera(50, 3, 0.1, 500);
  private rearTarget = new THREE.WebGLRenderTarget(512, 170);
  private overlay = new THREE.Scene();
  private overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mirrorQuad: THREE.Mesh;
  private yaw = 0;
  private pitch = 0;
  private chasePos = new THREE.Vector3();
  private chaseReady = false;
  private tmp = new THREE.Vector3();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private headQuat = new THREE.Quaternion();
  showMirror = false;

  constructor(private car: Car) {
    // Rear-view picture, mirrored left-to-right like a real mirror.
    const tex = this.rearTarget.texture;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1;
    this.mirrorQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, depthTest: false }),
    );
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false }));
    frame.renderOrder = -1;
    this.mirrorQuad.add(frame);
    frame.scale.set(1.04, 1.1, 1);
    frame.position.z = -0.01;
    this.overlay.add(this.mirrorQuad);
  }

  toggle() {
    this.mode = this.mode === 'driver' ? 'chase' : 'driver';
    this.chaseReady = false;
  }

  resize(width: number, height: number) {
    this.main.aspect = width / height;
    this.main.updateProjectionMatrix();
    // Mirror sits top-centre, about 30% of the screen wide.
    const aspect = width / height;
    this.overlayCam.left = -aspect;
    this.overlayCam.right = aspect;
    this.overlayCam.updateProjectionMatrix();
    const w = aspect * 0.6;
    this.mirrorQuad.scale.set(w, w / 3, 1);
    this.mirrorQuad.position.set(0, 1 - w / 6 - 0.05, 0);
  }

  update(head: HeadInput, dt: number) {
    let targetYaw = 0;
    let targetPitch = 0;
    if (head.mirror) {
      targetYaw = MIRROR_YAW;
      targetPitch = MIRROR_PITCH;
    } else if (head.lookLeft !== head.lookRight) {
      targetYaw = head.lookLeft ? LOOK_YAW : -LOOK_YAW;
    }
    const k = 1 - Math.exp(-HEAD_RATE * dt);
    this.yaw += (targetYaw - this.yaw) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.showMirror = head.mirror;

    const carMesh = this.car.mesh;
    if (this.mode === 'driver') {
      this.main.position.copy(DRIVER_EYE).applyMatrix4(carMesh.matrixWorld);
      this.euler.set(this.pitch, FACE_FORWARD + this.yaw, 0);
      this.main.quaternion.copy(carMesh.quaternion).multiply(this.headQuat.setFromEuler(this.euler));
    } else {
      // Chase cam: behind and above, smoothed. Q/E/M swing it round too.
      const back = this.car.forward(this.tmp).multiplyScalar(-7).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
      const target = back.add(carMesh.position).setY(carMesh.position.y + 3);
      if (!this.chaseReady) this.chasePos.copy(target);
      this.chasePos.lerp(target, 1 - Math.exp(-5 * dt));
      this.chaseReady = true;
      this.main.position.copy(this.chasePos);
      this.main.lookAt(carMesh.position.x, carMesh.position.y + 1, carMesh.position.z);
    }

    // Rear-view camera at the interior mirror, looking backwards.
    this.rear.position.copy(MIRROR_POS).applyMatrix4(carMesh.matrixWorld);
    this.euler.set(0, -FACE_FORWARD, 0);
    this.rear.quaternion.copy(carMesh.quaternion).multiply(this.headQuat.setFromEuler(this.euler));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    if (this.showMirror) {
      // Hide the car body so the mirror camera doesn't see the inside of the cabin.
      this.car.mesh.visible = false;
      renderer.setRenderTarget(this.rearTarget);
      renderer.render(scene, this.rear);
      renderer.setRenderTarget(null);
      this.car.mesh.visible = true;
    }
    renderer.render(scene, this.main);
    if (this.showMirror) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(this.overlay, this.overlayCam);
      renderer.autoClear = true;
    }
  }
}
