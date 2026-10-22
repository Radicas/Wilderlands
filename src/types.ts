/**
 * Wilderlands · 领域类型定义
 */
import type * as THREE from 'three';

export type UnitRole = 'player' | 'wolf';

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

export interface TreeEnt {
  p: THREE.Vector3;
  mesh: THREE.Group;
  alive: boolean;
  respawn: number;
}

export interface RockEnt {
  p: THREE.Vector3;
  mesh: THREE.Mesh;
  hp: number;
  alive: boolean;
  respawn: number;
}

export interface Building {
  type: 'fence' | 'house';
  mesh: THREE.Group;
}

export type TaskType = 'move' | 'gather' | 'attack' | 'trade';

export interface UnitTask {
  type: TaskType;
  kind?: 'tree' | 'rock' | 'crop';
  target?: Tile | TreeEnt | RockEnt | Unit;
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
  limbs: UnitLimbs;
  mesh: THREE.Group;
  wanderT: number;
  wanderPos: THREE.Vector3 | null;
  attackT: number;
  update(dt: number): void;
  setSelect(v: boolean): void;
  takeDamage(dmg: number): void;
  moveToward(p: THREE.Vector3, dt: number): boolean;
  lookAtTarget(p: THREE.Vector3): void;
}
