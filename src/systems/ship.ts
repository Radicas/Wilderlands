/**
 * Wilderlands · 主线修船（S4）
 * 倒扣在荒野的破船：投入木材/石头修复，集齐触发"通关"（船翻正 + 狼船长登场）。
 * 完成判定为纯函数，可被 node 自动回归。本模块无 DOM/three 依赖。
 */
import { CFG } from '../config';
import { logMsg } from './log';

/** 主线修船状态（持久，进存档 v3） */
export const ship = { wood: 0, stone: 0, done: false };

/** 材料是否集齐（纯函数） */
export function shipReady(wood: number, stone: number): boolean {
  return wood >= CFG.shipWoodNeed && stone >= CFG.shipStoneNeed;
}

/** 完成态持久化切换（唯一写入口） */
export function completeShip(): void {
  ship.done = true;
  logMsg('咣当！破船翻正了——主线达成。');
}

/** 投入材料；返回是否成功（不校验距离，距离由 UI 层把关） */
export function donateToShip(id: 'wood' | 'stone', amount: number): boolean {
  if (ship.done) return false;
  if (id === 'wood') {
    ship.wood = Math.min(CFG.shipWoodNeed, ship.wood + amount);
  } else {
    ship.stone = Math.min(CFG.shipStoneNeed, ship.stone + amount);
  }
  return true;
}
