/**
 * Wilderlands · headless 模拟层：SimUnit（纯逻辑单位）
 * 从 entities/unit.ts（前端表现类）提取的"纯规则"：
 * 平面移动 / 朝向 / 受伤与倒地 / 饥饿 / 任务状态机与采集结算。
 * 不含 mesh、动画、场景、DOM——node 可直接运行。
 * 规则对照：specs/008-headless-sim/spec.md §3（防漂移）。
 */
import { CFG } from '../config';
import type { Inventory, Skills } from '../types';
import { groundHeightAt } from './terrain';
import type { SimGatherKind, SimLimbs, SimTask, SimUnitState, SimWorld } from './types';
import { invAdd, invCanAdd, invTotal } from '../systems/inventory';
import { atkBonus, emptySkills, gainSkill, harvestBonus, refreshCapacity } from '../systems/skills';
import {
  atkFromAttr, defBonusOf, emptyAttrs, gainAttrXp, incomingDamage,
  isHungerPenalty, isStaminaLow, staminaCap, vitalityCap,
} from '../systems/attributes';
import { logMsg } from '../systems/log';

export class SimUnit implements SimUnitState {
  role: 'player' | 'wolf';
  name: string;
  x: number;
  z: number;
  y: number;
  hp: number;
  maxHp: number;
  hunger: number;
  speed: number;
  task: SimTask | null = null;
  down = false;
  downT = 0;
  atkT = 0;
  attackT = 0;
  facing = 0;
  dead = false;
  atkDmg: number = CFG.atkDmg;
  hasSpear = false;
  inv: Inventory;
  skills: Skills = emptySkills();
  capacity: number = CFG.inventoryCap;
  limbs: SimLimbs = { 头: 100, 躯干: 100, 左臂: 100, 右臂: 100, 左腿: 100, 右腿: 100 };
  attrs = emptyAttrs();
  moveXpT = 0;
  wanderT = 0;
  wanderPos: { x: number; z: number } | null = null;
  targetPos: { x: number; z: number } | null = null;

  constructor(role: 'player' | 'wolf', x: number, z: number, name: string, inv: Inventory = {}) {
    this.role = role;
    this.hp = role === 'wolf' ? CFG.wolfHp : vitalityCap(this);
    this.maxHp = this.hp;
    this.hunger = 100;
    this.y = groundHeightAt(x, z);
    this.x = x;
    this.z = z;
    this.speed = role === 'wolf' ? CFG.wolfSpeed : CFG.playerSpeed;
    this.name = name;
    this.inv = { ...inv };
    refreshCapacity(this);
  }

  /** 平面距离（忽略 y：y 跟随地面，3D 距离会让到达判定受地形干扰） */
  dist2(px: number, pz: number): number {
    return Math.hypot(px - this.x, pz - this.z);
  }

  lookAtTarget(px: number, pz: number): void {
    const dx = px - this.x;
    const dz = pz - this.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) this.facing = Math.atan2(dx, dz);
  }

  /** 朝目标移动一步；返回是否仍在移动（false = 已到达） */
  moveToward(px: number, pz: number, dt: number): boolean {
    const d = this.dist2(px, pz);
    let slow = this.hunger < 30 ? 0.5 : 1;
    // 负重超载减速（与前端 invRatio ≥ overloadRatio 同口径）
    if (this.capacity > 0 && invTotal(this.inv) / this.capacity >= CFG.overloadRatio) {
      slow *= CFG.overloadSlow;
    }
    // 体力告急减速（spec 010：≤20% → ×0.8）
    if (isStaminaLow(this)) slow *= 0.8;
    if (d > 0.2) {
      const dirX = (px - this.x) / d;
      const dirZ = (pz - this.z) / d;
      this.x += dirX * this.speed * slow * dt;
      this.z += dirZ * this.speed * slow * dt;
      this.y = groundHeightAt(this.x, this.z);
      this.lookAtTarget(px, pz);
      // 跑动消耗体力；每跑 10 秒涨 1 体力经验
      this.attrs.stamina = Math.max(0, this.attrs.stamina - CFG.staminaMoveCost * dt);
      this.moveXpT += dt;
      if (this.moveXpT >= 10 - 1e-6) { this.moveXpT -= 10; gainAttrXp(this, 'staminaXp', 1); }
      return true;
    }
    return false;
  }

  /** 受伤；死亡/倒地判定与击杀结算（规则同 entities/unit.ts takeDamage） */
  takeDamage(dmg: number, attacker?: SimUnit, pierce = false): void {
    if (this.down || this.dead) return;
    // 防御减伤只对攻击生效（max(1, dmg - defLv)）；饥饿等持续掉血走 pierce 原样扣
    const dmgIn = pierce ? dmg : incomingDamage(dmg, this);
    if (attacker?.role === 'wolf') gainAttrXp(this, 'defXp', 1);
    this.hp = Math.max(0, this.hp - dmgIn);
    if (this.hp <= 0) {
      this.down = true;
      this.downT = 0;
      this.task = null;
      this.targetPos = null;
      if (this.role === 'player') {
        logMsg(this.name + ' 倒下了，等待恢复…');
      } else {
        this.dead = true;
        if (attacker && attacker.role === 'player') {
          invAdd(attacker, 'food', 2);
          gainSkill(attacker, 'combat', 3);
        }
        logMsg('击败野狼，食物 +2');
      }
    }
  }

  /** 每帧：倒地恢复 + 饥饿 + 木屋回血（无任务时也调用） */
  idleTick(world: SimWorld, dt: number): void {
    if (this.dead) return;
    if (this.down) {
      this.downT += dt;
      if (this.downT >= CFG.downRecover) {
        this.down = false;
        this.hp = Math.max(this.hp, 50);
        if (this.role === 'player') {
          logMsg(this.name + ' 苏醒了');
          gainAttrXp(this, 'vitalityXp', 1); // 大难不死，生命力见长
        }
      }
      return;
    }
    if (this.role === 'player') {
      this.hunger = Math.max(0, this.hunger - CFG.hungerRate * dt);
      if (this.hunger <= 0) this.takeDamage(1 * dt, undefined, true);
      // 静止恢复体力（有任务就不回——站着不动才叫休息）
      if (!this.task) this.attrs.stamina = Math.min(staminaCap(this), this.attrs.stamina + CFG.staminaRest * dt);
    }
    // 木屋回血（规则同 entities/unit.ts：距木屋 <6 → +5/s，封顶生命力上限）
    if (this.role === 'player' && this.hp > 0) {
      for (const b of world.buildings) {
        if (b.type === 'house' && Math.hypot(b.x - this.x, b.z - this.z) < 6) {
          this.hp = Math.min(vitalityCap(this), this.hp + 5 * dt);
          break;
        }
      }
    }
  }

  /** 任务状态机（规则同 entities/unit.ts update 的任务分支） */
  taskTick(world: SimWorld, dt: number): void {
    const t = this.task;
    if (!t || this.down || this.dead) return;
    if (t.type === 'move' || t.type === 'walk') {
      if (!this.moveToward(t.pos.x, t.pos.z, dt)) this.task = null;
    } else if (t.type === 'gather') {
      if (!this.moveToward(t.pos.x, t.pos.z, dt)) {
        // 饥饿 ≤20 → 采集变慢（×0.9）
        t.workT += dt * (isHungerPenalty(this.hunger) ? CFG.hungerWorkSlow : 1);
        if (t.workT >= (t.workDur ?? 2)) this._finishGather(world, t);
      }
    } else if (t.type === 'attack') {
      const idx = t.target ?? -1;
      const target = t.targetRole === 'wolf' ? world.wolves[idx] : world.players[idx];
      if (!target || target.dead || target.down) {
        this.task = null;
        return;
      }
      const dist = this.dist2(target.x, target.z);
      if (dist > 1.9) {
        const dest = this.targetPos;
        if (dest && this.dist2(dest.x, dest.z) > 0.3) {
          this.moveToward(dest.x, dest.z, dt);
        } else {
          this.moveToward(target.x, target.z, dt);
        }
      } else {
        this.lookAtTarget(target.x, target.z);
        this.atkT -= dt;
        if (this.atkT <= 0) {
          this.atkT = CFG.atkCd;
          // 饥饿 ≤20 → 攻击 -1（荒诞：把斧头看成了鸡腿）；攻击属性加成（spec 010）
          const dmg = this.atkDmg + atkFromAttr(this) + atkBonus(this) - (isHungerPenalty(this.hunger) ? CFG.hungerAtkPenalty : 0);
          target.takeDamage(dmg, this);
          if (target.role === 'wolf') {
            gainAttrXp(this, 'atkXp', 1); // 命中狼练攻击
            this.attrs.stamina = Math.max(0, this.attrs.stamina - CFG.staminaAtkCost);
          }
        }
      }
    } else if (t.type === 'trade') {
      if (!this.moveToward(t.pos.x, t.pos.z, dt)) {
        t.workT += dt;
        if (t.workT >= 1.2) {
          this.task = null;
          logMsg(this.name + ' 已来到贸易站');
        }
      }
    }
  }

  /** 采集结算（规则同 entities/unit.ts _finishGather） */
  private _finishGather(world: SimWorld, t: SimTask): void {
    const kind = (t.kind ?? 'tree') as SimGatherKind;
    // 采集消耗体力 + 涨体力经验（体力=每天的干活预算）
    this.attrs.stamina = Math.max(0, this.attrs.stamina - (kind === 'crop' ? CFG.staminaFarmCost : CFG.staminaWorkCost));
    gainAttrXp(this, 'staminaXp', 1);
    if (kind === 'tree') {
      const tree = world.trees[t.target ?? -1];
      if (!tree || !tree.alive) { this.task = null; return; }
      if (!invCanAdd(this, 'wood', CFG.woodPerTree)) {
        logMsg(this.name + ' 背包已满，放不下更多木材');
        this.task = null;
        return;
      }
      invAdd(this, 'wood', CFG.woodPerTree);
      tree.alive = false;
      tree.respawn = 45;
      gainSkill(this, 'gather', 1);
      refreshCapacity(this); // 采集升级 → 负重立即 +4
      logMsg('砍倒树木，木材 +' + CFG.woodPerTree);
      this._cancelSameTarget(world, 'gather', t.target);
    } else if (kind === 'rock') {
      const rock = world.rocks[t.target ?? -1];
      if (!rock || !rock.alive) { this.task = null; return; }
      if (!invCanAdd(this, 'stone', CFG.stonePerVein)) {
        logMsg(this.name + ' 背包已满，放不下更多石头');
        this.task = null;
        return;
      }
      invAdd(this, 'stone', CFG.stonePerVein);
      rock.hp -= 1;
      gainSkill(this, 'gather', 1);
      refreshCapacity(this);
      logMsg('开采矿石，石头 +' + CFG.stonePerVein);
      if (rock.hp <= 0) {
        rock.alive = false;
        rock.respawn = 90;
        logMsg('矿脉采空了');
        this._cancelSameTarget(world, 'gather', t.target);
      }
    } else if (kind === 'crop') {
      const tile = world.tiles[t.target ?? -1];
      if (!tile || tile.state !== 3) {
        this.task = null;
        return;
      }
      const gain = CFG.cropPerHarvest + harvestBonus(this);
      if (!invCanAdd(this, 'food', gain)) {
        logMsg(this.name + ' 背包已满，放不下更多食物');
        this.task = null;
        return;
      }
      invAdd(this, 'food', gain);
      tile.state = 0;
      tile.grow = 0;
      gainSkill(this, 'farm', 1);
      logMsg('收获作物，食物 +' + gain);
    } else {
      const berry = world.berries[t.target ?? -1];
      if (!berry || !berry.alive) { this.task = null; return; }
      if (!invCanAdd(this, 'berry', CFG.berryFood)) {
        logMsg(this.name + ' 背包已满，放不下更多浆果');
        this.task = null;
        return;
      }
      invAdd(this, 'berry', CFG.berryFood);
      berry.alive = false;
      berry.respawn = CFG.berryRespawn;
      gainSkill(this, 'gather', 1);
      refreshCapacity(this);
      logMsg('采集浆果，浆果 +' + CFG.berryFood);
      this._cancelSameTarget(world, 'gather', t.target);
    }
    this.task = null;
  }

  /** 取消所有正在采同一资源（同类型且同 target 索引）的角色任务 */
  private _cancelSameTarget(world: SimWorld, type: SimTask['type'], targetIdx: number | undefined): void {
    for (const u of [...world.players, ...world.wolves]) {
      if (u.task?.type === type && u.task.target === targetIdx) u.task = null;
    }
  }
}
