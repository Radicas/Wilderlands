/**
 * Wilderlands · 全局共享状态
 * 各系统通过 state 交换数据，避免模块间循环依赖。
 */
import * as THREE from 'three';
import type { BerryEnt, Building, RockEnt, Tile, TreeEnt, Unit, WandererEnt } from './types';
import { START_GOLD } from './config';

/** 小队公共金币（货币，不占负重；资源物品进个人背包） */
export let gold = START_GOLD;

/** 金币入账（出售/战利品） */
export function addGold(n: number): void {
  gold += n;
}

/** 金币扣费；不足返回 false 且不扣 */
export function trySpendGold(n: number): boolean {
  if (gold < n) return false;
  gold -= n;
  return true;
}

/** 直接设定金币（读档恢复用） */
export function setGold(n: number): void {
  gold = n;
}
export const tiles: Tile[] = [];
export const trees: TreeEnt[] = [];
export const rocks: RockEnt[] = [];
export const berries: BerryEnt[] = [];
export const buildings: Building[] = [];
export let wanderer: WandererEnt | null = null;
export function setWanderer(w: WandererEnt | null): void {
  wanderer = w;
}
export const players: Unit[] = [];
export const wolves: Unit[] = [];

/** 当前选中角色（保持引用同步） */
export const selected: Unit[] = [];

/** 把角色移出选中（倒地/死亡时调用，避免命令落到无法执行的单位上） */
export function removeSelected(u: Unit): void {
  const i = selected.indexOf(u);
  if (i >= 0) {
    u.setSelect(false);
    selected.splice(i, 1);
  }
}

/** 收获飘字事件缓冲（entities 推入，ui/floaters 每帧消费；change gather-feedback） */
export const gainFx: { x: number; y: number; z: number; text: string; color?: string }[] = [];

/** 模式：0 探索 / 1 播种 / 2 围栏 / 3 木屋 */
export let modeNow = 0;
export function setMode(m: number): void {
  modeNow = m;
}

/** 可交互实体 mesh（射线命令：树/岩/狼/商摊/建筑） */
export const interMeshes: THREE.Object3D[] = [];

/** 可点选的角色部件 mesh */
export const selectableMeshes: THREE.Object3D[] = [];

/** 贸易站位置与组 */
export const merchantPos = new THREE.Vector3(2 * 2, 0, 8 * 2); // (4, 0, 16)
export const shop = new THREE.Group();

/** 消息日志实现由 ui/hud 注册（实现在 systems/log，纯函数无 three 依赖） */
export { logMsg, setLogHandler } from './systems/log';

/** 昼夜时间：t ∈ [0,1)，0 = 日出；isNight = 夜晚标志 */
export const timeOfDay = { t: 0.1, isNight: false };

// ---- 存档待读标记（读档 = 写标记 → 重载 → 启动时按存档初始化） ----
const PENDING_KEY = 'wilderlands.save.pending';

export function getSavePending(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function setSavePending(slot: string): void {
  try {
    localStorage.setItem(PENDING_KEY, slot);
  } catch {
    /* 隐私模式等：静默失败，下次读档不受影响 */
  }
}

export function clearSavePending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}
