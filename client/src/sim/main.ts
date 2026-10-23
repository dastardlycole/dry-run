import * as THREE from 'three';

// Placeholder scene: ground plane + box car. Replaced by Rapier vehicle + OSM world (SPEC §4.1–4.2).
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc7e8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 100, 30);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshLambertMaterial({ color: 0x4a7a3a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const car = new THREE.Mesh(
  new THREE.BoxGeometry(1.8, 1.4, 4.2),
  new THREE.MeshLambertMaterial({ color: 0xd33 }),
);
car.position.y = 0.7;
scene.add(car);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);
camera.position.set(0, 4, 10);
camera.lookAt(car.position);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => renderer.render(scene, camera));

const status = document.querySelector('#status')!;
fetch('/api/health')
  .then((r) => r.json())
  .then((h) => (status.textContent = `server ok · mongo ${h.mongo}`))
  .catch(() => (status.textContent = 'server offline'));
