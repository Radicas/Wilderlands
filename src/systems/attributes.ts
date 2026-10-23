/**
 * Wilderlands · 个体属性系统（spec 010，用就长）
 * 五维属性：体力 stamina / 生命力 vitality / 攻击 atk / 防御 def / 饥饿度 hunger（消耗性，不升级）。
 * 属性等级复用技能阈值表 skillXPForLevel；经验只在此处累加，派生数值只在此处查询。
 * 分工：属性管"底子"（上限/减伤/攻击），技能管"效率"（采集量/收获量/救治）。
 */
import { CFG } from '../config';
import { skillLevel } from './skills';
import { logMsg } from './log';

/** 结构化最小接口：前端单位与 headless sim 单位均满足 */
export interface AttrUnit {
  name: string;
  attrs: { stamina: number; staminaXp: number; vitalityXp: number; atkXp: number; defXp: number };
}

export interface Attrs {
  stamina: number;
  staminaXp: number;
  vitalityXp: number;
  atkXp: number;
  defXp: number;
}

export function emptyAttrs(): Attrs {
  return { stamina: CFG.staminaBase, staminaXp: 0, vitalityXp: 0, atkXp: 0, defXp: 0 };
}

// ---- 等级（经验表与技能共用，封顶 Lv5） ----

export function attrLevel(xp: number): number {
  return skillLevel(xp);
}

/** 加属性经验；跨级时荒诞提示（怎么玩就怎么长） */
export function gainAttrXp(u: AttrUnit, id: keyof Omit<Attrs, 'stamina'>, xp = 1): void {
  const key = id;
  const before = attrLevel(u.attrs[key]);
  u.attrs[key] += xp;
  const after = attrLevel(u.attrs[key]);
  if (after > before) {
    const lines: Record<string, string> = {
      staminaXp: u.name + ' 耐力见长——大概是天天搬木头搬出来的。',
      vitalityXp: u.name + ' 觉得身子骨结实了，大概是挨咬挨的。',
      atkXp: u.name + ' 挥斧子更有劲了。树又少了一个朋友。',
      defXp: u.name + ' 又被咬了。他感觉皮厚了一点。',
    };
    logMsg(lines[key]);
  }
}

// ---- 派生数值 ----

/** 体力上限（基础 100 + 10/级，封顶 150） */
export function staminaCap(u: Pick<AttrUnit, 'attrs'>): number {
  return Math.min(CFG.staminaBase + attrLevel(u.attrs.staminaXp) * CFG.attrStaminaPerLv,
    CFG.staminaBase + CFG.attrStaminaPerLv * 5);
}

/** 生命力上限（基础 100 + 5/级，封顶 150） */
export function vitalityCap(u: Pick<AttrUnit, 'attrs'>): number {
  return Math.min(100 + attrLevel(u.attrs.vitalityXp) * CFG.attrVitalityPerLv,
    100 + CFG.attrVitalityPerLv * 5);
}

/** 攻击属性加成（+1/级，叠加到 atkDmg） */
export function atkFromAttr(u: Pick<AttrUnit, 'attrs'>): number {
  return attrLevel(u.attrs.atkXp) * CFG.attrAtkPerLv;
}

/** 防御减伤（+1/级） */
export function defBonusOf(u: Pick<AttrUnit, 'attrs'>): number {
  return attrLevel(u.attrs.defXp) * CFG.attrDefPerLv;
}

/** 体力是否告急（≤20% 上限） */
export function isStaminaLow(u: Pick<AttrUnit, 'attrs'>): boolean {
  return u.attrs.stamina <= staminaCap(u) * CFG.staminaLowPct;
}

/** 饥饿惩罚是否生效（≤20） */
export function isHungerPenalty(hunger: number): boolean {
  return hunger <= CFG.hungerPenaltyAt;
}

/** 实际受击伤害：狼伤 3 → max(1, 3-defLv) */
export function incomingDamage(dmg: number, u: Pick<AttrUnit, 'attrs'>): number {
  return Math.max(1, dmg - defBonusOf(u));
}
