/**
 * Wilderlands · 商人动态价格（S3）
 * 收购价随当日成交量下跌：基准价 - floor(成交量/阈值)，保底 min；
 * 天亮时成交量衰减（隔日回升）。本模块无 DOM/three 依赖，可被 node 自动回归。
 */
import { CFG } from '../config';

export type SellId = 'food' | 'wood' | 'stone';

/** 商人当日收购成交量（卖得越多价越低；不存档，读档/天亮重置） */
export const soldToday = { food: 0, wood: 0, stone: 0 };

/** 当前收购价（纯函数）：卖得越多价越低，不低于保底 */
export function buyPrice(id: SellId, sold: number): number {
  const c = CFG.tradeBuy[id];
  return Math.max(c.min, c.base - Math.floor(sold / c.dropPer));
}

/** 记录一次卖出；返回本次成交价（卖前价） */
export function recordSold(id: SellId): number {
  const p = buyPrice(id, soldToday[id]);
  soldToday[id] += 1;
  return p;
}

/** 天亮衰减：隔日回升（成交量 × tradeRecover，向下取整） */
export function recoverTrade(): void {
  for (const k of Object.keys(soldToday) as SellId[]) {
    soldToday[k] = Math.floor(soldToday[k] * CFG.tradeRecover);
  }
}
