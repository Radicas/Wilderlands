/**
 * Wilderlands · headless 模拟层：领域类型（纯数据，无 three/DOM）
 * 与前端 types.ts 的关系：这里是"模拟世界"的最小状态，前端实体/表现不参与。
 */
import type { Inventory, ItemId, Skills, TileState } from '../types';
import type { Rng } from './rng';

export type SimTaskType = 'move' | 'walk' | 'gather' | 'attack' | 'trade';
export type SimGatherKind = 'tree' | 'rock' | 'crop' | 'berry';

/** 模拟任务（target = 世界内资源/单位索引；pos = 目标站位点） */
export interface SimTask {
  type: SimTaskType;
  kind?: SimGatherKind;
  pos: { x: number; z: number };
  /** gather：trees/rocks/berries/tiles 索引；attack：玩家/狼索引（配合 targetRole） */
  target?: number;
  targetRole?: 'player' | 'wolf';
  workT: number;
  workDur?: number;
}

export interface SimLimbs {
  头: number;
  躯干: number;
  左臂: number;
  右臂: number;
  左腿: number;
  右腿: number;
}

/** 模拟单位状态（纯数据；方法在 SimUnit 类，见 sim/unit.ts） */
export interface SimUnitState {
  role: 'player' | 'wolf';
  name: string;
  x: number;
  z: number;
  y: number;
  hp: number;
  maxHp: number;
  hunger: number;
  speed: number;
  task: SimTask | null;
  down: boolean;
  downT: number;
  atkT: number;
  attackT: number;
  facing: number;
  dead: boolean;
  atkDmg: number;
  hasSpear: boolean;
  inv: Inventory;
  skills: Skills;
  capacity: number;
  limbs: SimLimbs;
  wanderT: number;
  wanderPos: { x: number; z: number } | null;
  targetPos: { x: number; z: number } | null;
}

export interface SimTree {
  x: number;
  z: number;
  alive: boolean;
  /** 当前阶段倒计时（stump/sprout/young 复用，同前端 respawn 语义） */
  respawn: number;
  /** 树种 index（TREES 表，i%4 确定性映射） */
  species: number;
  /** 生长阶段（与前端 TreePhase 同枚举） */
  phase: 'stump' | 'sprout' | 'young' | 'mature';
}

export interface SimRock {
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  respawn: number;
}

export interface SimBerry {
  x: number;
  z: number;
  alive: boolean;
  respawn: number;
}

export interface SimTile {
  x: number;
  z: number;
  state: TileState;
  grow: number;
  isHome: boolean;
}

export interface SimShip {
  wood: number;
  stone: number;
  done: boolean;
}

export interface SimWanderer {
  x: number;
  z: number;
  name: string;
  available: boolean;
  respawn: number;
}

export interface SimBuilding {
  type: 'fence' | 'house';
  x: number;
  z: number;
}

/** 模拟世界（唯一权威状态容器；simTick 只改这里） */
export interface SimWorld {
  rng: Rng;
  // 商摊位置（情绪『独自一人』判定与交易任务共用；同前端 state.merchantPos）
  merchant: { x: number; z: number };
  t: number;
  isNight: boolean;
  gold: number;
  soldToday: { food: number; wood: number; stone: number };
  players: import('./unit').SimUnit[];
  wolves: import('./unit').SimUnit[];
  trees: SimTree[];
  rocks: SimRock[];
  berries: SimBerry[];
  tiles: SimTile[];
  buildings: SimBuilding[];
  wanderer: SimWanderer | null;
  ship: SimShip;
  /** 事件流（模拟日志，等价前端 logMsg 文本） */
  events: string[];
  /** 刷狼计时（内部） */
  _wolfSpawnT?: number;
  /** 禁止刷狼（测试/剧情控制） */
  wolfSpawnDisabled?: boolean;
}
