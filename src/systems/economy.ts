/**
 * Wilderlands · 经济系统
 * 背包与进食。
 */
import { CFG } from '../config';
import { bag, logMsg, selected } from '../state';

/** F 键进食：选中角色吃 1 份食物，恢复饥饿 */
export function eatFood(): void {
  if (!selected.length) {
    logMsg('先选中一名拓荒者再进食');
    return;
  }
  if (bag.food < 1) {
    logMsg('没有食物了，去收获或打猎吧');
    return;
  }
  const u = selected[0];
  if (u.down) return;
  bag.food -= 1;
  u.hunger = Math.min(100, u.hunger + CFG.eatHeal);
  logMsg(u.name + ' 进食，饥饿 +' + CFG.eatHeal);
}
