/**
 * Wilderlands · headless 模拟层：确定性随机（LCG）
 * 让模拟可复现（固定种子 → 相同事件流），与前端 Math.random 解耦。
 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** [0,1) 均匀分布 */
  next(): number {
    // 32 位 LCG（Numerical Recipes 参数）
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  /** 弧度 [0, 2π) */
  angle(): number {
    return this.next() * Math.PI * 2;
  }
}
