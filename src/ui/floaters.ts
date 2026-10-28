/**
 * Wilderlands · 收获飘字（change gather-feedback F2）
 * entities 层把收益推进 state.gainFx 缓冲（sim 可无副作用），ui 层每帧消费渲染。
 * 纯表现层：无游戏规则，不进 sim。
 */
import * as THREE from 'three';
import { gainFx } from '../state';
import { camera, renderer } from '../core/renderer';

let layer: HTMLElement | null = null;

export function initFloaters(): void {
  if (layer) return;
  layer = document.createElement('div');
  layer.id = 'floaters';
  document.body.appendChild(layer);
}

/** 世界坐标 → 屏幕 → DOM 浮字（1.2 秒上浮淡出后自动移除） */
export function floatText(x: number, y: number, z: number, text: string, color = '#ffd76a'): void {
  if (!layer) return;
  const v = new THREE.Vector3(x, y, z).project(camera);
  if (v.z > 1 || v.z < -1) return; // 相机背面/裁剪外
  const rect = renderer.domElement.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'floater';
  el.textContent = text;
  el.style.left = rect.left + (v.x * 0.5 + 0.5) * rect.width + 'px';
  el.style.top = rect.top + (-v.y * 0.5 + 0.5) * rect.height + 'px';
  el.style.color = color;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

/** 每帧消费收益事件缓冲（stepGame 尾部调用） */
export function drainGainFx(): void {
  if (!gainFx.length) return;
  for (const g of gainFx) floatText(g.x, g.y, g.z, g.text, g.color);
  gainFx.length = 0;
}
