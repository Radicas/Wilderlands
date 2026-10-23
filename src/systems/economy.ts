/**
 * Wilderlands · 经济系统
 * 进食：从选中首位的背包扣食物（优先食物，不足用浆果兜底），喂所有选中者。
 */
import { CFG } from '../config';
import { logMsg, selected } from '../state';

/** F 键进食：所有选中角色各吃 1 份，恢复饥饿 */
export function eatFood(): void {
  const eaters = selected.filter((u) => !u.down);
  if (!selected.length) {
    logMsg('先选中一名拓荒者再进食');
    return;
  }
  if (!eaters.length) return;
  const from = selected[0];
  const need = eaters.length;
  const food = from.inv.food ?? 0;
  const berry = from.inv.berry ?? 0;
  if (food + berry < need) {
    logMsg('食物不足（' + need + ' 人各需 1 份，背包还有 ' + food + ' 食物 + ' + berry + ' 浆果）');
    return;
  }
  const takeFood = Math.min(food, need);
  const takeBerry = need - takeFood;
  if (takeFood > 0) from.inv.food = food - takeFood;
  if (takeBerry > 0) from.inv.berry = berry - takeBerry;
  for (const u of eaters) {
    u.hunger = Math.min(100, u.hunger + CFG.eatHeal);
  }
  logMsg(eaters.length + ' 名拓荒者进食，饥饿 +' + CFG.eatHeal);
}
