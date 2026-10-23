/**
 * Wilderlands · 战斗系统
 * 野狼 AI（追击/攻击/游荡）、刷怪节奏、资源重生。
 */
import * as THREE from 'three';
import { CFG, WORLD } from '../config';
import type { Unit } from '../types';
import { berries, interMeshes, logMsg, players, rocks, timeOfDay, trees, wanderer, wolves } from '../state';
import { scene } from '../core/renderer';
import { tileAt } from '../core/world';
import { PioneerUnit } from '../entities/unit';

export function spawnWolf(): void {
  if (wolves.length >= CFG.wolfMax) return;
  for (let k = 0; k < 12; k++) {
    const a = Math.random() * Math.PI * 2;
    // 家园区半径 = WORLD.homeRadius * TILE = 20 世界单位，必须刷在园区之外
    const r = WORLD.homeRadius * 2 + 2 + Math.random() * 8; // 22..30
    const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const t = tileAt(p.x, p.z);
    if (t && t.isHome) continue;
    if (wolves.some((w) => w.pos.distanceTo(p) < 1.5)) continue;
    // 避开树/岩石，防止野狼"卡"进资源模型里
    if (trees.some((tr) => tr.alive && tr.p.distanceTo(p) < 1.4)) continue;
    if (rocks.some((rk) => rk.alive && rk.p.distanceTo(p) < 1.4)) continue;
    new PioneerUnit('wolf', p.x, p.z);
    return;
  }
}

let wolfSpawnT = 0;

export function updateWolves(dt: number): void {
  // 夜晚野狼更激进：侦测距离加大、跑得更快
  const night = timeOfDay.isNight;
  const detect = night ? 18 : 11;

  for (const w of wolves) {
    if (w.dead || w.down) continue;

    // 追击最近玩家
    let nearest: Unit | null = null;
    let nd = detect;
    for (const u of players) {
      const d = w.pos.distanceTo(u.pos);
      if (d < nd && !u.down) {
        nd = d;
        nearest = u;
      }
    }

    if (nearest) {
      if (Math.hypot(nearest.pos.x - w.pos.x, nearest.pos.z - w.pos.z) < 1.7) {
        // 攻击
        w.attackT -= dt;
        if (w.attackT <= 0) {
          w.attackT = 1;
          nearest.takeDamage(CFG.wolfDmg);
          logMsg(w.name + ' 咬伤了 ' + nearest.name);
        }
        w.lookAtTarget(nearest.pos);
        w.mesh.rotation.y = w.facing;
      } else {
        w.moveToward(nearest.pos, dt * (night ? 1.15 : 1));
      }
    } else {
      // 游荡（平面距离判定，避免地形高度差让狼永远"走不到"游荡点）
      if (!w.wanderPos || Math.hypot(w.wanderPos.x - w.pos.x, w.wanderPos.z - w.pos.z) < 0.5) {
        w.wanderT -= dt;
        if (w.wanderT <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 4;
          w.wanderPos = new THREE.Vector3(
            w.pos.x + Math.cos(a) * r,
            0,
            w.pos.z + Math.sin(a) * r,
          );
          w.wanderT = 2 + Math.random() * 3;
        }
      } else {
        w.moveToward(w.wanderPos, dt);
      }
    }
  }

  // 移除死亡狼（同时清理可交互列表，避免射线打到已消失的狼）
  for (let i = wolves.length - 1; i >= 0; i--) {
    const w = wolves[i];
    if (w.dead) {
      scene.remove(w.mesh);
      for (let j = interMeshes.length - 1; j >= 0; j--) {
        const ent = interMeshes[j].userData.ent as { kind?: string; ent?: unknown };
        if (ent && ent.kind === 'wolf' && ent.ent === w) interMeshes.splice(j, 1);
      }
      wolves.splice(i, 1);
    }
  }
}

export function updateWorld(dt: number): void {
  // 资源重生
  for (const tree of trees) {
    if (!tree.alive) {
      tree.respawn -= dt;
      if (tree.respawn <= 0) {
        tree.alive = true;
        tree.mesh.visible = true;
      }
    }
  }
  for (const rock of rocks) {
    if (!rock.alive) {
      rock.respawn -= dt;
      if (rock.respawn <= 0) {
        rock.alive = true;
        rock.hp = 3;
        rock.mesh.visible = true;
      }
    }
  }
  // 浆果丛重生
  for (const b of berries) {
    if (!b.alive) {
      b.respawn -= dt;
      if (b.respawn <= 0) {
        b.alive = true;
        b.mesh.visible = true;
      }
    }
  }
  // 流浪者重生（被招募后过一阵子来新人）
  if (wanderer && !wanderer.available) {
    wanderer.respawn -= dt;
    if (wanderer.respawn <= 0) {
      wanderer.available = true;
      wanderer.mesh.visible = true;
    }
  }
  // 刷狼（夜晚刷新更快）
  wolfSpawnT += dt;
  const interval = CFG.wolfSpawn * (timeOfDay.isNight ? 0.55 : 1);
  if (wolfSpawnT >= interval) {
    wolfSpawnT = 0;
    spawnWolf();
  }
}
