/**
 * Wilderlands · 角色 AI（spec 011）
 * 纯逻辑：性格随机、狼来了反应、闲时找活、情绪倍率。
 * 不 import three，可被 sim 层复用。
 */
import { CFG } from '../config';
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

// ——— 情绪状态机（spec 011 §2，前端与 sim 共用同一实现）———
// 调用方每秒低频采样环境（wolfNear 等），本函数只做纯判定，随机数由调用方注入保证 sim 确定性。

export interface MoodInput {
  mood: Mood;
  trait: TraitType;
  hunger: number;
  stamina: number;
  nearMarket: boolean;   // 商摊 15 米内（moodFearRadius）
  night: boolean;
  wolfNear: boolean;     // 有狼进入 autoEngage 距离
  allyNear: boolean;     // 10 米内有存活队友
  sawDownedAlly: boolean;// 目击视野内队友倒地（edge 每 tick 现算）
  working: boolean;      // 正在采集类任务
  berryCount: number;
  downcastT: number;     // 低落剩余秒数
}

export type MoodEvent =
  | 'moodChanged'
  | 'quipWork' | 'quipWolf' | 'quipNight' | 'quipHunger'
  | 'eatBerry';

export interface MoodResult { mood: Mood; downcastT: number; events: MoodEvent[] }

/** 话痨吐槽文案（两端共享，前端 log 与 sim 断言同一来源） */
export const QUIPS_WORK = ['这棵树长得还挺结实。', '手都磨出茧了…', '今天天气不错，就是有点忙。'];
export const QUIPS_WOLF = ['有情况！那边那位不怀好意…', '它过来了，它过来了它过来了。'];
export const QUIPS_NIGHT = ['天黑请闭眼，但我不敢。', '晚上最适合讲的故事是明天的。'];
export const QUIP_HUNGER = '我都快饿死了还折腾…';

/** 情绪变化日志文案（moodChanged 时由调用方拼名字输出） */
export const MOOD_LOG: Record<Mood, string> = {
  fear: ' 害怕了，干活都哆嗦', irritable: ' 烦躁得很', exhausted: ' 累瘫了',
  downcast: ' 情绪低落', neutral: '',
};

/**
 * 每秒情绪 tick：触发（单标签，后到覆盖先到前保持 neutral 才触发）、消退、话痨吐槽、吃货自主啃浆果。
 * 规则：惩罚倍率只作用于当前标签（speed/workMultiplier 取最差，天然不叠乘）；
 * downcast 压制话痨（低落时不说话）；情绪变化才允许日志，防刷屏。
 */
export function moodStep(i: MoodInput, r: number): MoodResult {
  const events: MoodEvent[] = [];
  let mood = i.mood;
  let downcastT = i.downcastT;

  // 低落自然消退（30 秒）
  if (mood === 'downcast') {
    downcastT -= 1;
    if (downcastT <= 0) { mood = 'neutral'; downcastT = 0; events.push('moodChanged'); }
  }

  // 目击队友倒地：狼还在场 → 害怕；无即时威胁 → 低落
  if (i.sawDownedAlly && mood === 'neutral') {
    mood = i.wolfNear ? 'fear' : 'downcast';
    if (mood === 'downcast') downcastT = CFG.moodDowncastDur;
    events.push('moodChanged');
  }

  // 夜晚独自一人（离商摊 >15 米）→ 害怕
  if (mood === 'neutral' && i.night && !i.nearMarket) {
    mood = 'fear';
    events.push('moodChanged');
  }

  // 饥饿 → 烦躁；体力 → 疲惫（仅 neutral 时触发，与现有实现一致）
  if (mood === 'neutral' && i.hunger <= 20) { mood = 'irritable'; events.push('moodChanged'); }
  if (mood === 'neutral' && i.stamina <= 20) { mood = 'exhausted'; events.push('moodChanged'); }

  // 消退：进食消烦躁 / 休息消疲惫 / 回摊·队友在旁·（白天且狼已不在）消害怕
  if (mood === 'irritable' && i.hunger > 40) { mood = 'neutral'; events.push('moodChanged'); }
  else if (mood === 'exhausted' && i.stamina > 40) { mood = 'neutral'; events.push('moodChanged'); }
  else if (mood === 'fear' && (i.nearMarket || i.allyNear || (!i.night && !i.wolfNear))) { mood = 'neutral'; events.push('moodChanged'); }

  // 话痨吐槽（低落压制；狼>夜>饿>活 优先级，每 tick 最多一句）
  if (i.trait === 'talkative' && mood !== 'downcast' && r < CFG.moodTalkChance) {
    if (i.wolfNear) events.push('quipWolf');
    else if (i.night) events.push('quipNight');
    else if (i.hunger <= 20) events.push('quipHunger');
    else if (i.working) events.push('quipWork');
  }

  // 吃货：背包有浆果且饥饿低于阈值 → 自主啃食（消费方执行扣减与日志）
  if (i.trait === 'glutton' && i.hunger < CFG.gluttonHungerAt && i.berryCount > 0) events.push('eatBerry');

  return { mood, downcastT, events };
}
