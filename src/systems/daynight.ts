/**
 * Wilderlands · 昼夜循环
 * 太阳绕轨道运行：光照强度/色温、天空与雾色、时辰 HUD 标签。
 * 夜晚野狼更激进由 combat.ts 读取 state.timeOfDay.isNight 实现。
 */
import * as THREE from 'three';
import { setBed } from '../core/sound';
import { CFG } from '../config';
import { scene } from '../core/renderer';
import { hemi, sun } from '../core/renderer';
import { timeOfDay } from '../state';
import { recoverTrade } from './trade';

const DAY_SKY = new THREE.Color(0xaab88e);
const NIGHT_SKY = new THREE.Color(0x1c2330);
const DAY_FOG = new THREE.Color(0xaab88e);
const NIGHT_FOG = new THREE.Color(0x131a26);
const SUN_DAY = new THREE.Color(0xffe8c0);
const SUN_DUSK = new THREE.Color(0xff8a4a);

const tmpCol = new THREE.Color();

export function updateDayNight(dt: number): void {
  // t ∈ [0,1)，0 = 日出（太阳在东方地平线）
  const prevT = timeOfDay.t;
  const prevNight = timeOfDay.isNight;
  timeOfDay.t = (timeOfDay.t + dt / CFG.daySeconds) % 1;
  timeOfDay.isNight = timeOfDay.t >= CFG.nightStartRatio;
  if (timeOfDay.isNight !== prevNight) setBed(timeOfDay.isNight); // 声景翻转沿联动（D6）
  // 新的一天：商人成交压力衰减（隔日回升）
  if (timeOfDay.t < prevT) recoverTrade();

  const a = timeOfDay.t * Math.PI * 2;
  const el = Math.sin(a); // 太阳高度：-1..1

  // 太阳沿轨道移动（东西向 + 高度）
  sun.position.set(Math.cos(a) * 46, Math.max(-10, el * 50 + 2), 14);

  // 光照强度：白天有太阳，夜晚仅剩微光
  const dayAmt = Math.max(0, el);
  sun.intensity = dayAmt * 1.6;
  hemi.intensity = 0.32 + dayAmt * 0.63;

  // 早晚霞光：太阳接近地平线时偏暖橙
  const dusk = Math.max(0, 1 - Math.abs(el) / 0.45);
  tmpCol.copy(SUN_DAY).lerp(SUN_DUSK, dusk);
  sun.color.copy(tmpCol);

  // 天空与雾色渐变
  const nightAmt = 1 - Math.min(1, Math.max(0, (el + 0.15) / 0.75));
  tmpCol.copy(DAY_SKY).lerp(NIGHT_SKY, nightAmt);
  (scene.background as THREE.Color).copy(tmpCol);
  (scene.fog as THREE.Fog).color.copy(DAY_FOG).lerp(NIGHT_FOG, nightAmt);
}

/** 时辰标签（HUD 用） */
export function timePhaseLabel(): string {
  const t = timeOfDay.t;
  const nr = CFG.nightStartRatio;
  if (t < nr * 0.22) return '清晨';
  if (t < nr * 0.55) return '白天';
  if (t < nr) return '黄昏';
  if (t < nr + (1 - nr) * 0.55) return '夜晚';
  return '深夜';
}
