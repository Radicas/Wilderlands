/**
 * Wilderlands · 输入系统
 * 键盘（WASD/QE/数字键/F）、鼠标（左键框选/点选、右键命令、中键旋转、滚轮缩放）
 */
import { cam, renderer, updateCameraMove } from './renderer';
import { boxSelect, commandAt, selectAt, toNDC, touchAction } from '../systems/commands';
import { eatFood } from '../systems/economy';
import { updateHover } from '../ui/tooltip';
import { closeAllPanels } from '../ui/panels';

export const keys: Record<string, boolean> = {};
let shiftKey = false;
let rotDrag = false;
let lastMX = 0;
let lastMY = 0;

// 框选状态
let boxSelecting = false;
let boxStartX = 0;
let boxStartY = 0;
let boxEl: HTMLDivElement | null = null;

function createBoxEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;border:1px solid #4d9de0;background:rgba(77,157,224,0.2);' +
    'pointer-events:none;z-index:100;display:none;';
  document.body.appendChild(el);
  return el;
}

function updateBoxEl(x1: number, y1: number, x2: number, y2: number): void {
  if (!boxEl) return;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  boxEl.style.left = left + 'px';
  boxEl.style.top = top + 'px';
  boxEl.style.width = w + 'px';
  boxEl.style.height = h + 'px';
  boxEl.style.display = 'block';
}

export function initInput(): void {
  const canvas = renderer.domElement;
  boxEl = createBoxEl();

  let mouseDownX = 0;
  let mouseDownY = 0;
  let mouseDownTime = 0;

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      // 左键：记录起点，准备框选
      boxSelecting = true;
      boxStartX = e.clientX;
      boxStartY = e.clientY;
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
      mouseDownTime = Date.now();
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
    if (boxSelecting) {
      updateBoxEl(boxStartX, boxStartY, e.clientX, e.clientY);
    }
    updateHover(e.clientX, e.clientY);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 1) {
      rotDrag = false;
    }
    if (e.button === 0 && boxSelecting) {
      boxSelecting = false;
      if (boxEl) boxEl.style.display = 'none';

      const dx = Math.abs(e.clientX - mouseDownX);
      const dy = Math.abs(e.clientY - mouseDownY);
      const dt = Date.now() - mouseDownTime;

      // 拖拽距离小、时间短 = 点选；否则 = 框选
      if (dx < 5 && dy < 5 && dt < 300) {
        selectAt(toNDC(e.clientX, e.clientY), shiftKey);
      } else {
        boxSelect(boxStartX, boxStartY, e.clientX, e.clientY, shiftKey);
      }
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      cam.dist = Math.max(8, Math.min(80, cam.dist * (e.deltaY > 0 ? 1.08 : 0.92)));
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
    if (e.code === 'Escape') {
      // 面板打开时优先关面板
      const open = ['trade', 'shipPanel', 'saveModal', 'invPicker'].some(
        (id) => (document.getElementById(id) as HTMLElement | null)?.style.display === 'block' ||
          (document.getElementById(id) as HTMLElement | null)?.style.display === 'flex',
      );
      if (open) closeAllPanels();
    }
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
