/**
 * Wilderlands · 领域类型定义
 */
import type * as THREE from 'three';

export type UnitRole = 'player' | 'wolf';

/** 背包物品类型（资源物品；金币为公共货币不进背包） */
export type ItemId = 'wood' | 'stone' | 'food' | 'seed' | 'berry';

/** 每人背包：物品 id → 数量 */
export type Inventory = Partial<Record<ItemId, number>>;

/** 技能类型（v0.4：熟练度成长） */
export type SkillId = 'gather' | 'combat' | 'farm';

/** 技能经验：技能 id → 经验值 */
export type Skills = Record<SkillId, number>;

// ---- 角色 AI（spec 011）----
export type CombatType = 'aggressive' | 'cautious' | 'timid' | 'stoic';
export type WorkType = 'hardworking' | 'lazy' | 'gatherer' | 'woodsman';
export type TraitType = 'talkative' | 'quiet' | 'glutton' | 'tough';
export type Mood = 'neutral' | 'fear' | 'irritable' | 'exhausted' | 'downcast';

export interface Personality {
  combat: CombatType;
  work: WorkType;
  trait: TraitType;
}

export interface UnitSave {
  name: string;
  x: number;
  z: number;
  hp: number;
  hunger: number;
  hasSpear: boolean;
  atkDmg: number;
  inv: Inventory;
  skills: Skills;
  attrs: { stamina: number; staminaXp: number; vitalityXp: number; atkXp: number; defXp: number };
  personality?: Personality;
  mood?: Mood;
}

export interface BuildingSave {
  type: 'fence' | 'house';
  x: number;
  z: number;
}

export interface TileSave {
  x: number;
  z: number;
  state: TileState;
  grow: number;
}

/** 主线修船（S4）：已投入材料与完成态 */
export interface ShipSave {
  wood: number;
  stone: number;
  done: boolean;
}

/** 存档数据（当前版本 5：spec 011 性格+情绪；历史 v1–v4 由 migrate 逐级升级） */
export interface SaveData {
  version: 5;
  /** 静音态（sound-system D7：可选字段，缺省 false，SAVE_VERSION 不动） */
  muted?: boolean;
  savedAt: string;
  gold: number;
  time: number;
  units: UnitSave[];
  buildings: BuildingSave[];
  tiles: TileSave[];
  wanderer: { available: boolean; respawn: number } | null;
  ship: ShipSave;
}

export interface Bag {
  gold: number;
  wood: number;
  stone: number;
  food: number;
  seed: number;
}

/** 地块状态：0 荒地 / 1 播种 / 2 生长 / 3 成熟 */
export type TileState = 0 | 1 | 2 | 3;

export interface Tile {
  x: number;
  z: number;
  state: TileState;
  grow: number;
  isHome: boolean;
  mesh: THREE.Mesh;
  ear: THREE.Mesh;
}

export type TreePhase = 'stump' | 'sprout' | 'young' | 'mature';

/** 各阶段实例矩阵（build 期预计算，换阶 O(1) 拷贝——forest-life D6） */
export interface TreeMats {
  sprout: { trunk: THREE.Matrix4; crown: THREE.Matrix4 };
  young: { trunk: THREE.Matrix4; crown: THREE.Matrix4 };
  mature: { trunk: THREE.Matrix4; crown: THREE.Matrix4 };
}

export interface TreeEnt {
  p: THREE.Vector3;
  /** 逻辑锚点（InstancedMesh 化后不再是真实 Group，visible 变更会驱动 instance matrix） */
  mesh: THREE.Object3D;
  /** 等价 phase !== 'stump'（D7：计数/拾取/建造避让沿用） */
  alive: boolean;
  /** 复用为当前阶段倒计时（stump 空窗 / sprout / young 逐段） */
  respawn: number;
  /** 树种 index（TREES 表） */
  species: number;
  /** 该树种 InstancedMesh 对内的实例序号 */
  slot: number;
  phase: TreePhase;
  mats: TreeMats;
}

export interface RockEnt {
  p: THREE.Vector3;
  /** 逻辑锚点（InstancedMesh 化后不再是真实 Mesh，visible 变更会驱动 instance matrix） */
  mesh: THREE.Object3D;
  hp: number;
  alive: boolean;
  respawn: number;
}

export interface BerryEnt {
  p: THREE.Vector3;
  mesh: THREE.Group;
  alive: boolean;
  respawn: number;
}

export interface WandererEnt {
  p: THREE.Vector3;
  mesh: THREE.Group;
  name: string;
  available: boolean;
  respawn: number;
}

export interface Building {
  type: 'fence' | 'house';
  mesh: THREE.Group;
}

export type TaskType = 'move' | 'walk' | 'gather' | 'attack' | 'trade';

export interface UnitTask {
  type: TaskType;
  kind?: 'tree' | 'rock' | 'crop' | 'berry' | 'sow';
  /** 挥击节拍步数（workT/单程三等分，sound-system 音效对齐用） */
  hitStep?: number;
  target?: Tile | TreeEnt | RockEnt | BerryEnt | Unit;
  pos?: THREE.Vector3;
  workT: number;
  workDur?: number;
}

export interface UnitLimbs {
  头: number;
  躯干: number;
  左臂: number;
  右臂: number;
  左腿: number;
  右腿: number;
}

/** 动画状态 */
export type AnimState = 'idle' | 'walk' | 'gather' | 'attack';

/** 四肢 mesh 引用（用于动画驱动） */
export interface LimbRefs {
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  forearmL?: THREE.Object3D;
  forearmR?: THREE.Object3D;
  calfL?: THREE.Object3D;
  calfR?: THREE.Object3D;
  torso?: THREE.Object3D;
  head?: THREE.Object3D;
  tail?: THREE.Object3D;
  earL?: THREE.Object3D;
  earR?: THREE.Object3D;
}

export interface Unit {
  role: UnitRole;
  name: string;
  hp: number;
  maxHp: number;
  hunger: number;
  pos: THREE.Vector3;
  speed: number;
  targetPos: THREE.Vector3 | null;
  task: UnitTask | null;
  down: boolean;
  downT: number;
  atkT: number;
  facing: number;
  selected: boolean;
  dead: boolean;
  atkDmg: number;
  hasSpear: boolean;
  equipSpear(): void;
  inv: Inventory;
  capacity: number;
  skills: Skills;
  attrs: { stamina: number; staminaXp: number; vitalityXp: number; atkXp: number; defXp: number };
  limbs: UnitLimbs;
  personality: Personality;
  mood: Mood;
  mesh: THREE.Group;
  wanderT: number;
  wanderPos: THREE.Vector3 | null;
  attackT: number;
  update(dt: number): void;
  setSelect(v: boolean): void;
  takeDamage(dmg: number, attacker?: Unit): void;
  moveToward(p: THREE.Vector3, dt: number): boolean;
  lookAtTarget(p: THREE.Vector3): void;
}
