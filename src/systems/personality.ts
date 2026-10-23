/**
 * Wilderlands · 角色 AI（spec 011）
 * 纯逻辑：性格随机、狼来了反应、闲时找活、情绪倍率。
 * 不 import three，可被 sim 层复用。
 */
import type { CombatType, Mood, Personality, TraitType, WorkType } from '../types';

const COMBATS: CombatType[] = ['aggressive', 'cautious', 'timid', 'stoic'];
const WORKS: WorkType[] = ['hardworking', 'lazy', 'gatherer', 'woodsman'];
const TRAITS: TraitType[] = ['talkative', 'quiet', 'glutton', 'tough'];

function pick<T>(arr: T[], r: number): T {
  return arr[Math.floor(r * arr.length) % arr.length];
}

/** 随机一套性格（r ∈ [0,1)，三路独立随机） */
export function rollPersonality(r1: number, r2: number, r3: number): Personality {
  return {
    combat: pick(COMBATS, r1),
    work: pick(WORKS, r2),
    trait: pick(TRAITS, r3),
  };
}

/** 狼来了反应（玩家未下命令时） */
export type WolfReaction = 'engage' | 'flee' | 'wait';

export function decideWolfReaction(combat: CombatType, distToWolf: number, hpRatio: number): WolfReaction {
  switch (combat) {
    case 'aggressive':
      return 'engage';
    case 'stoic':
      return hpRatio < 0.3 ? 'flee' : 'engage';
    case 'timid':
      return 'flee';
    case 'cautious':
    default:
      return 'wait';
  }
}

/** 闲时可采集目标（位置+是否存活，由调用方从 entities 抽取） */
export interface IdleTarget {
  kind: 'tree' | 'rock' | 'berry';
  x: number;
  z: number;
}

/**
 * 闲时找活：以领队位置为中心 radius 内找最近目标。
 * 按 work 性格排序优先级：gatherer 优先浆果，woodsman 优先树，hardworking 按距离。
 * lazy 永远返回 null。
 */
export function findIdleWork(
  work: WorkType,
  leaderX: number,
  leaderZ: number,
  targets: IdleTarget[],
  radius: number,
): IdleTarget | null {
  if (work === 'lazy') return null;
  // 过滤范围内
  const inRange = targets.filter((t) => {
    const dx = t.x - leaderX;
    const dz = t.z - leaderZ;
    return dx * dx + dz * dz <= radius * radius;
  });
  if (!inRange.length) return null;
  // 按距离排序
  inRange.sort((a, b) => {
    const da = (a.x - leaderX) ** 2 + (a.z - leaderZ) ** 2;
    const db = (b.x - leaderX) ** 2 + (b.z - leaderZ) ** 2;
    return da - db;
  });
  if (work === 'gatherer') {
    return inRange.find((t) => t.kind === 'berry') ?? inRange[0];
  }
  if (work === 'woodsman') {
    return inRange.find((t) => t.kind === 'tree') ?? inRange[0];
  }
  // hardworking：最近的就行
  return inRange[0];
}

/** 情绪对移动速度的倍率 */
export function speedMoodMultiplier(mood: Mood): number {
  switch (mood) {
    case 'fear': return 0.8;
    case 'exhausted': return 0.9;
    default: return 1;
  }
}

/** 情绪对工作速度的倍率 */
export function workMoodMultiplier(mood: Mood): number {
  switch (mood) {
    case 'irritable': return 0.9;
    case 'fear': return 0.8;
    default: return 1;
  }
}
