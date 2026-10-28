/**
 * Wilderlands · 招募条件门（纯函数，单一数据源）
 * "人的价值是很高的"：玩家必须先经历磨砺、达成一定条件，才配也才养得起一名同伴。
 * 无 DOM / three 依赖，前端 commands 与后台 sim 共用一套口径，避免漂移。
 */
import { CFG } from '../config';

/** 招募所需的"世界快照"（三系统各取其一：住所、余粮、金币） */
export interface RecruitInputs {
  houses: number;   // 已建木屋数
  teamFood: number; // 全队口粮合计（食物 + 浆果，两者都能充饥）
  gold: number;     // 公共金币
}

/**
 * 返回"还缺什么"的清单（荒诞但明确，逐条点名）。
 * 空数组 = 达成全部条件，可以招募。顺序固定，便于测试与 UI 展示。
 */
export function recruitBlockers(i: RecruitInputs): string[] {
  const out: string[] = [];
  if (i.houses < CFG.recruitNeedHouse) {
    out.push('先给同伴一个屋顶 · 建 ' + CFG.recruitNeedHouse + ' 座木屋（木材 ' + CFG.houseCostWood + ' + 石头 ' + CFG.houseCostStone + '）');
  }
  if (i.teamFood < CFG.recruitNeedFood) {
    out.push('养第二条命要余粮 · 全队口粮（食物+浆果）需 ' + CFG.recruitNeedFood + '（现在 ' + i.teamFood + '，去种田/采浆果）');
  }
  if (i.gold < CFG.recruitCost) {
    out.push('人是很贵的 · 招募需 ' + CFG.recruitCost + ' 金（现在 ' + i.gold + '）');
  }
  return out;
}

/** 三条件是否全部满足 */
export function canRecruit(i: RecruitInputs): boolean {
  return recruitBlockers(i).length === 0;
}
