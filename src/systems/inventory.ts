/**
 * Wilderlands · 背包系统
 * 物品增删/容量/负重/转移的唯一入口。所有"加/扣/转"必须经过这里，
 * 保证容量与负重计算一致（宪法 II：数值全部来自 config）。
 */
import { CFG, ITEMS } from '../config';
import type { Inventory, ItemId } from '../types';

/** 结构化最小接口：前端单位与 headless sim 单位均满足（避免 sim 依赖表现层类型） */
export interface InvUnit { name: string; inv: Inventory; capacity: number; }
import { logMsg } from '../state';

/** 背包负重 = Σ(数量 × weight) */
export function invTotal(inv: Inventory): number {
  let sum = 0;
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    sum += (inv[id] ?? 0) * ITEMS[id].weight;
  }
  return sum;
}

/** 某物品当前数量 */
export function invCount(inv: Inventory, id: ItemId): number {
  return inv[id] ?? 0;
}

/** 负重占比 0..1 */
export function invRatio(u: Pick<InvUnit, 'inv' | 'capacity'>): number {
  return Math.min(1, invTotal(u.inv) / u.capacity);
}

/** 是否还能再携带 n 个该物品 */
export function invCanAdd(u: Pick<InvUnit, 'inv' | 'capacity'>, id: ItemId, n: number): boolean {
  return invTotal(u.inv) + n * ITEMS[id].weight <= u.capacity;
}

/** 加入背包；失败（超容）返回 false */
export function invAdd(u: Pick<InvUnit, 'name' | 'inv' | 'capacity'>, id: ItemId, n: number): boolean {
  if (n <= 0) return true;
  if (!invCanAdd(u, id, n)) {
    logMsg(u.name + ' 背包已满，装不下' + ITEMS[id].label);
    return false;
  }
  u.inv[id] = (u.inv[id] ?? 0) + n;
  return true;
}

/** 扣除背包；数量不足返回 false */
export function invRemove(u: Pick<InvUnit, 'name' | 'inv'>, id: ItemId, n: number): boolean {
  const have = u.inv[id] ?? 0;
  if (have < n) {
    logMsg(u.name + ' 的' + ITEMS[id].label + '不足');
    return false;
  }
  const next = have - n;
  if (next === 0) delete u.inv[id];
  else u.inv[id] = next;
  return true;
}

/**
 * 转移物品（1..n 个）：from 扣、to 加，全程校验容量。
 * 丢弃：to 传 null。
 */
export function transferItem(from: InvUnit, to: InvUnit | null, id: ItemId, n: number): boolean {
  if (n <= 0 || (from.inv[id] ?? 0) < n) return false;
  if (to) {
    if (!invCanAdd(to, id, n)) {
      logMsg(to.name + ' 背包已满，无法接收' + ITEMS[id].label);
      return false;
    }
    invRemove(from, id, n);
    to.inv[id] = (to.inv[id] ?? 0) + n;
    logMsg(from.name + ' → ' + to.name + ' ' + ITEMS[id].label + ' ×' + n);
  } else {
    invRemove(from, id, n);
    logMsg(from.name + ' 丢弃了 ' + ITEMS[id].label + ' ×' + n);
  }
  return true;
}
