/**
 * Wilderlands · headless 模拟层：纯地形
 * 无状态、无 three/DOM 依赖：噪声、地面高度、世界常量。
 * 由前端 core/world.ts re-export（单一权威，消除地形双份）。
 */
import { WORLD } from '../config';

export const TILE = WORLD.tileSize;
export const GRID = WORLD.grid;

/** 地形噪声（多倍频叠加，自然起伏）——与 core/world.ts 原实现一致 */
export function noise2D(x: number, z: number): number {
  const low = Math.sin(x * 0.15 + Math.cos(z * 0.2)) * 0.6
            + Math.sin(z * 0.18 + Math.cos(x * 0.12)) * 0.4;
  const mid = Math.sin(x * 0.5 + Math.cos(z * 0.7)) * 0.25
            + Math.sin(z * 0.6 + Math.cos(x * 0.5)) * 0.2;
  const high = Math.sin(x * 1.5 + Math.sin(z * 1.3)) * 0.08
             + Math.cos(z * 1.7 + Math.sin(x * 1.1)) * 0.07;
  return low + mid + high;
}

/** 查世界坐标 (x, z) 处的地面高度 Y（家园区域衰减起伏） */
export function groundHeightAt(x: number, z: number): number {
  const n = noise2D(x, z);
  const dist = Math.hypot(x / TILE, z / TILE);
  const flatFactor = Math.min(1, Math.max(0, (dist - WORLD.homeRadius * 0.6) / 3));
  return n * WORLD.terrainAmp * (0.3 + flatFactor * 0.7);
}
