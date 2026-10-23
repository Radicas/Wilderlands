/**
 * Wilderlands · 技能系统（v0.4）
 * 熟练度：采集/战斗/种田各自累计经验，按阈值表升级，等级提供数值加成。
 * 经验只在此处累加，加成只在此处查询（宪法 II：阈值与加成数值全部来自 config）。
 */
import { CFG, SKILL_LABELS } from '../config';
import type { SkillId, Skills } from '../types';

/** 结构化最小接口：前端单位与 headless sim 单位均满足 */
export interface SkillUnit { name: string; skills: Skills; }
import { logMsg } from './log';

/** 经验 → 等级（Lv0..Lv5，阈值表在 config） */
export function skillLevel(xp: number): number {
  let lv = 0;
  for (const need of CFG.skillXPForLevel) {
    if (xp >= need) lv++;
    else break;
  }
  return lv;
}

export function skillOf(u: Pick<SkillUnit, 'skills'>, id: SkillId): number {
  return u.skills[id] ?? 0;
}

/** 加经验；跨级时提示 */
export function gainSkill(u: SkillUnit, id: SkillId, xp = 1): void {
  const before = skillLevel(skillOf(u, id));
  u.skills[id] = skillOf(u, id) + xp;
  const after = skillLevel(skillOf(u, id));
  if (after > before) logMsg(u.name + ' 的' + SKILL_LABELS[id] + '升到了 Lv' + after + '！');
}

// ---- 等级加成（读档恢复 skills 后这些查询自动反映） ----

/** 采集：每级 +4 负重上限 */
export function capacityBonus(u: Pick<SkillUnit, 'skills'>): number {
  return skillLevel(skillOf(u, 'gather')) * CFG.skillCapacityPerLv;
}

/** 单位：按当前技能重算负重上限（升级/读档后调用，保证加成即时生效） */
export function refreshCapacity(u: Pick<SkillUnit, 'skills'> & { capacity: number }): void {
  u.capacity = CFG.inventoryCap + capacityBonus(u);
}

/** 战斗：每级 +1 攻击（封顶 +4） */
export function atkBonus(u: Pick<SkillUnit, 'skills'>): number {
  return Math.min(CFG.skillAtkCap, skillLevel(skillOf(u, 'combat')) * CFG.skillAtkPerLv);
}

/** 种田：每级收获 +1 食物（封顶 +2） */
export function harvestBonus(u: Pick<SkillUnit, 'skills'>): number {
  return Math.min(CFG.skillHarvestCap, skillLevel(skillOf(u, 'farm')) * CFG.skillHarvestPerLv);
}

/** 创建默认空技能 */
export function emptySkills(): Skills {
  return { gather: 0, combat: 0, farm: 0 };
}
