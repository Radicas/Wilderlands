/**
 * Wilderlands · 输入系统
 * 键盘（WASD/QE/数字键/F）、鼠标（左键选择、右键命令、中键旋转、滚轮缩放）、触摸等价路径。
 */
import { cam, renderer, updateCameraMove } from './renderer';
import { commandAt, selectAt, toNDC, touchAction } from '../systems/commands';
import { eatFood } from '../systems/economy';
import { setMode } from '../state';
import { updateHover } from '../ui/tooltip';

export const keys: Record<string, boolean> = {};
let shiftKey = false;
let rotDrag = false;
let lastMX = 0;
let lastMY = 0;

export function initInput(): void {
  const canvas = renderer.domElement;

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      selectAt(toNDC(e.clientX, e.clientY), shiftKey);
    } else if (e.button === 1) {
      rotDrag = true;
      lastMX = e.clientX;
      lastMY = e.clientY;
    } else if (e.button === 2) {
      commandAt(toNDC(e.clientX, e.clientY));
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (rotDrag) {
      cam.theta -= (e.clientX - lastMX) * 0.005;
      cam.phi = Math.max(0.35, Math.min(1.35, cam.phi - (e.clientY - lastMY) * 0.005));
      lastMX = e.clientX;
      lastMY = e.clientY;
    }
    updateHover(e.clientX, e.clientY);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 1) rotDrag = false;
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      cam.dist = Math.max(8, Math.min(60, cam.dist * (e.deltaY > 0 ? 1.08 : 0.92)));
    },
    { passive: true },
  );

  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) touchAction(t.clientX, t.clientY);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyQ') cam.theta += 0.06;
    if (e.code === 'KeyE') cam.theta -= 0.06;
    if (e.code === 'Digit1') setMode(0);
    if (e.code === 'Digit2') setMode(1);
    if (e.code === 'Digit3') setMode(2);
    if (e.code === 'Digit4') setMode(3);
    if (e.code === 'Escape') setMode(0);
    if (e.code === 'KeyF') eatFood();
    keys[e.code] = true;
    shiftKey = e.shiftKey;
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    shiftKey = e.shiftKey;
  });
}

export function moveCamera(dt: number): void {
  updateCameraMove(keys, dt);
}
