/**
 * Wilderlands · 全局共享状态
 * 各系统通过 state 交换数据，避免模块间循环依赖。
 */
import * as THREE from 'three';
import type { Bag, Building, RockEnt, Tile, TreeEnt, Unit } from './types';
import { START_BAG } from './config';

export const bag: Bag = { ...START_BAG };
export const tiles: Tile[] = [];
export const trees: TreeEnt[] = [];
export const rocks: RockEnt[] = [];
export const buildings: Building[] = [];
export const players: Unit[] = [];
export const wolves: Unit[] = [];

/** 当前选中角色（保持引用同步） */
export const selected: Unit[] = [];

/** 模式：0 探索 / 1 播种 / 2 围栏 / 3 木屋 */
export let modeNow = 0;
export function setMode(m: number): void {
  modeNow = m;
}

/** 可交互实体 mesh（射线命令：树/岩/狼/商摊/建筑） */
export const interMeshes: THREE.Object3D[] = [];

/** 可点选的角色部件 mesh */
export const selectableMeshes: THREE.Object3D[] = [];

/** 贸易站位置与组 */
export const merchantPos = new THREE.Vector3(2 * 2, 0, 8 * 2); // (4, 0, 16)
export const shop = new THREE.Group();

/** 消息日志实现由 ui/hud 注册 */
export let logMsg: (s: string) => void = (s: string) => console.log('[log]', s);
export function setLogHandler(fn: (s: string) => void): void {
  logMsg = fn;
}
