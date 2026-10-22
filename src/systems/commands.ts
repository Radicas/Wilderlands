/**
 * Wilderlands · 命令系统
 * 左键选择、右键上下文命令（探索模式智能识别目标），模式化播种/建造。
 */
import * as THREE from 'three';
import { CFG } from '../config';
import type { Tile, TreeEnt, RockEnt, Unit } from '../types';
import { interMeshes, logMsg, merchantPos, modeNow, selected, selectableMeshes } from '../state';
import { TILE, tileAt } from '../core/world';
import { camera } from '../core/renderer';
import { plantTile } from './farm';
import { buildFence, buildHouse, nearBuilding } from './build';
import { openTrade } from '../ui/trade';

export const raycaster = new THREE.Raycaster();

export const toNDC = (x: number, y: number): THREE.Vector2 =>
  new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);

/** 射线与地面（y=0 平面）交点 */
export function rayGround(): THREE.Vector3 | null {
  const ray = raycaster.ray;
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const t = -ray.origin.y / ray.direction.y;
  if (t < 0) return null;
  return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
}

export function deselectAll(): void {
  selected.forEach((u) => u.setSelect(false));
  selected.length = 0;
}

export function selectAt(ndc: THREE.Vector2, shiftKey: boolean): void {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(selectableMeshes, false);
  if (!shiftKey) deselectAll();
  if (hits.length) {
    const u = hits[0].object.userData.unit as Unit | undefined;
    if (u && !u.down && !u.selected) {
      u.setSelect(true);
      selected.push(u);
    }
  }
}

export function commandAt(ndc: THREE.Vector2): void {
  if (!selected.length) {
    logMsg('先左键选中一名拓荒者，再下达命令');
    return;
  }
  raycaster.setFromCamera(ndc, camera);
  const g = rayGround();
  const hits = raycaster.intersectObjects(interMeshes, false);
  const ent = hits.length
    ? (hits[0].object.userData.ent as { kind: string; ent: any })
    : null;
  const mode = modeNow;

  if (mode === 0) {
    // —— 探索模式：上下文智能命令 ——
    if (ent && ent.kind === 'wolf' && !ent.ent.dead && !ent.ent.down) {
      selected.forEach((u) => {
        u.task = { type: 'attack', target: ent.ent as Unit, workT: 0 };
      });
      return;
    }
    if (ent && ent.kind === 'merchant') {
      selected.forEach((u) => {
        u.task = { type: 'trade', pos: merchantPos, workT: 0 };
      });
      return;
    }
    if (ent && ent.kind === 'tree' && ent.ent.alive) {
      const t = ent.ent as TreeEnt;
      selected.forEach((u) => {
        u.task = {
          type: 'gather',
          kind: 'tree',
          target: t,
          pos: t.p.clone(),
          workT: 0,
          workDur: 2.2,
        };
      });
      return;
    }
    if (ent && ent.kind === 'rock' && ent.ent.alive) {
      const r = ent.ent as RockEnt;
      selected.forEach((u) => {
        u.task = {
          type: 'gather',
          kind: 'rock',
          target: r,
          pos: r.p.clone(),
          workT: 0,
          workDur: 1.6,
        };
      });
      return;
    }
    if (g) {
      const tile = tileAt(g.x, g.z);
      if (tile && tile.state === 3) {
        const tp = new THREE.Vector3(tile.x * TILE, 0, tile.z * TILE);
        selected.forEach((u) => {
          u.task = {
            type: 'gather',
            kind: 'crop',
            target: tile,
            pos: tp,
            workT: 0,
            workDur: 1.2,
          };
        });
        return;
      }
      selected.forEach((u) => {
        u.task = { type: 'move', pos: new THREE.Vector3(g.x, 0, g.z), workT: 0 };
      });
    }
  } else if (mode === 1) {
    // —— 播种 ——
    const tile = (g && tileAt(g.x, g.z)) as Tile | undefined;
    if (tile) plantTile(tile);
  } else if (mode === 2) {
    // —— 围栏 ——
    if (!g || nearBuilding(g)) return;
    buildFence(g);
  } else if (mode === 3) {
    // —— 木屋 ——
    if (!g || nearBuilding(g)) return;
    buildHouse(g);
  }
}

/** 触摸等价路径：点角色选中，否则执行当前模式命令 */
export function touchAction(x: number, y: number): void {
  const ndc = toNDC(x, y);
  raycaster.setFromCamera(ndc, camera);
  const hitUnit = raycaster.intersectObjects(selectableMeshes, false).length > 0;
  if (hitUnit) selectAt(ndc, false);
  else if (selected.length) commandAt(ndc);
  else selectAt(ndc, false);
}
