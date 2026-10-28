/**
 * Wilderlands · 命令系统
 * 左键点选/框选、右键命令：探索模式"点什么做什么，点空地走路"；
 * 数字键 1-4 切换 探索/播种/围栏/木屋 模式（v0.1 模式条，v0.2 一度丢失，已恢复）。
 */
import * as THREE from 'three';
import { CFG } from '../config';
import type { BerryEnt, RockEnt, Tile, TreeEnt, Unit, WandererEnt } from '../types';
import { buildings, gold, interMeshes, logMsg, merchantPos, modeNow, players, selected, selectableMeshes, trySpendGold } from '../state';
import { tileAt } from '../core/world';
import { recruitBlockers } from './recruit';
import { plantTile } from './farm';
import { buildFence, buildHouse, nearBuilding } from './build';
import { camera } from '../core/renderer';
import { openTrade } from '../ui/trade';
import { openShip, talkCaptain } from '../ui/ship';
import { PioneerUnit } from '../entities/unit';

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

/** 框选：屏幕像素坐标矩形 → 选中框内所有拓荒者 */
export function boxSelect(x1: number, y1: number, x2: number, y2: number, shiftKey: boolean): void {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);

  if (!shiftKey) deselectAll();

  // 把每个角色投影到屏幕坐标，判断是否在框内
  const screenPos = new THREE.Vector3();
  for (const u of players) {
    if (u.down) continue;
    screenPos.copy(u.pos);
    screenPos.y = 1.5; // 胸口高度
    screenPos.project(camera);
    const sx = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
      if (!u.selected) {
        u.setSelect(true);
        selected.push(u);
      }
    }
  }
}

/**
 * 为小队分配围绕目标的站位点（每个角色一个角度，均匀分布）
 * 返回一个目标点数组，长度 = 选中角色数量
 */
function assignFormationPoints(center: THREE.Vector3, count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push(new THREE.Vector3(
      center.x + Math.cos(angle) * radius,
      0,
      center.z + Math.sin(angle) * radius,
    ));
  }
  return points;
}

/** 射线命中实体解析：普通 Mesh 直接读 userData.ent；InstancedMesh 按 instanceId 反查（右键命令与悬停提示共用一套，避免两处口径漂移） */
export type PickedEnt = { kind: string; ent: any };
export function pickEntity(h: THREE.Intersection): PickedEnt | null {
  const obj = h.object;
  const resolve = obj.userData.resolveInstance as ((id: number) => PickedEnt) | undefined;
  if (resolve && h.instanceId !== undefined && h.instanceId >= 0) return resolve(h.instanceId);
  return (obj.userData.ent as PickedEnt | undefined) ?? null;
}

export function commandAt(ndc: THREE.Vector2): void {
  if (!selected.length) {
    logMsg('先左键选中一名拓荒者，再下达命令');
    return;
  }
  raycaster.setFromCamera(ndc, camera);
  const g = rayGround();
  const hits = raycaster.intersectObjects(interMeshes, false);
  // 命中解析：与悬停提示同一套 pickEntity（InstancedMesh 反查 / 普通 Mesh 直读）
  const ent: PickedEnt | null = hits.length ? pickEntity(hits[0]) : null;
  // —— 建造类模式（播种 1 / 围栏 2 / 木屋 3）：对光标落点执行建造，费用走第一名选中者的背包 ——
  if (modeNow !== 0) {
    const payer = selected[0];
    if (!payer) return;
    if (modeNow === 1) {
      const tile = g ? tileAt(g.x, g.z) : undefined;
      if (tile) plantTile(tile, payer);
    } else if (modeNow === 2) {
      if (g && !nearBuilding(g)) buildFence(g, payer);
    } else if (modeNow === 3) {
      if (g && !nearBuilding(g)) buildHouse(g, payer);
    }
    return;
  }
  // —— 探索模式：右键智能命令（点什么做什么，点空地走路）——
  if (ent && ent.kind === 'wolf' && !ent.ent.dead && !ent.ent.down) {
      // 攻击：围绕野狼站位
      const points = assignFormationPoints(ent.ent.pos, selected.length, 1.8);
      selected.forEach((u, i) => {
        u.task = { type: 'attack', target: ent.ent as Unit, workT: 0 };
        // 移动目标点：先走到站位点，再攻击
        u.targetPos = points[i].clone();
      });
      return;
    }
    if (ent && ent.kind === 'wanderer' && ent.ent.available) {
      // 招募流浪者：先过"人很贵"条件门（屋顶/余粮/金币），全达成才扣钱入队
      const w = ent.ent as WandererEnt;
      const blockers = recruitBlockers({
        houses: buildings.filter((b) => b.type === 'house').length,
        teamFood: players.reduce((s, u) => s + (u.inv.food ?? 0) + (u.inv.berry ?? 0), 0),
        gold,
      });
      if (blockers.length) {
        logMsg('想招人，还得再熬一熬：' + blockers.join('；'));
        return;
      }
      if (!trySpendGold(CFG.recruitCost)) return; // 条件门已保证够钱，此处仅原子扣款兜底
      w.available = false;
      w.respawn = CFG.wandererRespawn;
      w.mesh.visible = false;
      const nu = new PioneerUnit('player', w.p.x, w.p.z, w.name);
      // 新队员同样注册交易回调（走到商摊后自动开面板并锁定自己）
      nu.setTradeCallback((me) => openTrade(me));
      logMsg(w.name + ' 加入了你的小队！');
      return;
    }
    if (ent && ent.kind === 'merchant') {
      const points = assignFormationPoints(merchantPos, selected.length, 2.5);
      selected.forEach((u, i) => {
        u.task = { type: 'trade', pos: points[i].clone(), workT: 0 };
      });
      return;
    }
    if (ent && ent.kind === 'ship') {
      // 修船：走到船边，打开修船面板（锁定这批角色为修船人，途中换选中不影响）
      const sp = CFG.shipPos;
      const points = assignFormationPoints(new THREE.Vector3(sp.x, 0, sp.z), selected.length, 2.5);
      selected.forEach((u, i) => {
        u.task = { type: 'walk', pos: points[i].clone(), workT: 0 };
      });
      openShip([...selected]);
      return;
    }
    if (ent && ent.kind === 'captain') {
      // 右键狼船长：荒诞对话
      talkCaptain();
      return;
    }
    if (ent && ent.kind === 'tree' && ent.ent.alive) {
      const t = ent.ent as TreeEnt;
      // 围绕树站位
      const points = assignFormationPoints(t.p, selected.length, 1.5);
      selected.forEach((u, i) => {
        u.task = {
          type: 'gather',
          kind: 'tree',
          target: t,
          pos: points[i].clone(),
          workT: 0,
          workDur: 2.2,
        };
      });
      return;
    }
    if (ent && ent.kind === 'rock' && ent.ent.alive) {
      const r = ent.ent as RockEnt;
      const points = assignFormationPoints(r.p, selected.length, 1.5);
      selected.forEach((u, i) => {
        u.task = {
          type: 'gather',
          kind: 'rock',
          target: r,
          pos: points[i].clone(),
          workT: 0,
          workDur: 1.6,
        };
      });
      return;
    }
    if (ent && ent.kind === 'berry' && ent.ent.alive) {
      const b = ent.ent as BerryEnt;
      const points = assignFormationPoints(b.p, selected.length, 1.3);
      selected.forEach((u, i) => {
        u.task = {
          type: 'gather',
          kind: 'berry',
          target: b,
          pos: points[i].clone(),
          workT: 0,
          workDur: 1.2,
        };
      });
      return;
    }
    if (g) {
      // 移动：小队分散站位
      const points = assignFormationPoints(g, selected.length, 0.8);
      selected.forEach((u, i) => {
        u.task = { type: 'move', pos: points[i].clone(), workT: 0 };
      });
    }
}

/** 触摸等价路径：点角色选中，否则执行右键命令 */
export function touchAction(x: number, y: number): void {
  const ndc = toNDC(x, y);
  raycaster.setFromCamera(ndc, camera);
  const hitUnit = raycaster.intersectObjects(selectableMeshes, false).length > 0;
  if (hitUnit) selectAt(ndc, false);
  else if (selected.length) commandAt(ndc);
  else selectAt(ndc, false);
}
