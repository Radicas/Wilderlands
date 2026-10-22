/**
 * Wilderlands · 战斗系统
 * 野狼 AI（追击/攻击/游荡）、刷怪节奏、资源重生。
 */
import * as THREE from 'three';
import { CFG } from '../config';
import type { Unit } from '../types';
import { logMsg, players, rocks, trees, wolves } from '../state';
import { scene } from '../core/renderer';
import { tileAt } from '../core/world';
import { PioneerUnit } from '../entities/unit';

export function spawnWolf(): void {
  if (wolves.length >= CFG.wolfMax) return;
  for (let k = 0; k < 12; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 6;
    const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const t = tileAt(p.x, p.z);
    if (t && t.isHome) continue;
    if (wolves.some((w) => w.pos.distanceTo(p) < 1.5)) continue;
    new PioneerUnit('wolf', p.x, p.z);
    return;
  }
}

let wolfSpawnT = 0;

export function updateWolves(dt: number): void {
  for (const w of wolves) {
    if (w.dead || w.down) continue;

    // 追击最近玩家
    let nearest: Unit | null = null;
    let nd = 11;
    for (const u of players) {
      const d = w.pos.distanceTo(u.pos);
      if (d < nd && !u.down) {
        nd = d;
        nearest = u;
      }
    }

    if (nearest) {
      if (nd < 1.7) {
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
        w.moveToward(nearest.pos, dt);
      }
    } else {
      // 游荡
      if (!w.wanderPos || w.pos.distanceTo(w.wanderPos) < 0.5) {
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

  // 移除死亡狼
  for (let i = wolves.length - 1; i >= 0; i--) {
    const w = wolves[i];
    if (w.dead) {
      scene.remove(w.mesh);
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
  // 刷狼
  wolfSpawnT += dt;
  if (wolfSpawnT >= CFG.wolfSpawn) {
    wolfSpawnT = 0;
    spawnWolf();
  }
}
