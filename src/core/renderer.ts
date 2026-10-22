/**
 * Wilderlands · 渲染核心
 * 场景 / 相机 / 光照 / 渲染器，及相机控制（WASD 平移、滚轮缩放、Q/E 旋转、中键旋转）。
 */
import * as THREE from 'three';
import { PALETTE } from '../config';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.background);
scene.fog = new THREE.Fog(PALETTE.fog, 55, 110);

export const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  300,
);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

// 挂载画布
const stage = document.getElementById('stage');
if (stage) stage.appendChild(renderer.domElement);

// 主光：暖色夕阳
const sun = new THREE.DirectionalLight(0xffe8c0, 1.6);
sun.position.set(18, 26, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
sun.shadow.camera.far = 60;
scene.add(sun);

// 天空补光
scene.add(new THREE.HemisphereLight(0xc8d8e8, 0x4a4034, 0.95));

export interface CamState {
  theta: number;
  phi: number;
  dist: number;
  target: THREE.Vector3;
}

export const cam: CamState = {
  theta: 0.9,
  phi: 1.18,
  dist: 22,
  target: new THREE.Vector3(0, 0, 0),
};

const UP = new THREE.Vector3(0, 1, 0);

export function updateCamera(): void {
  const sp = new THREE.Spherical(cam.dist, cam.phi, cam.theta);
  camera.position.setFromSpherical(sp).add(cam.target);
  camera.lookAt(cam.target);
}

/**
 * 相机平移（WASD / 方向键）。
 * @param keys 当前按住的键集合
 * @param dt 帧间隔（秒）
 */
export function updateCameraMove(keys: Record<string, boolean>, dt: number): void {
  let f = 0;
  let s = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyA || keys.ArrowLeft) s -= 1;
  if (keys.KeyD || keys.ArrowRight) s += 1;
  if (f === 0 && s === 0) return;

  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
  const spd = 13 * dt;
  cam.target.add(fwd.multiplyScalar(f * spd)).add(right.multiplyScalar(s * spd));
}

export function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
