/**
 * Wilderlands · headless 模拟层：SimUnit（纯逻辑单位）
 * 从 entities/unit.ts（前端表现类）提取的"纯规则"：
 * 平面移动 / 朝向 / 受伤与倒地 / 饥饿 / 任务状态机与采集结算。
 * 不含 mesh、动画、场景、DOM——node 可直接运行。
 * 规则对照：specs/008-headless-sim/spec.md §3（防漂移）。
 */
import { CFG, TREE_STUMP, TREES } from '../config';
import type { Inventory, Skills } from '../types';
import { groundHeightAt } from './terrain';
import type { SimGatherKind, SimLimbs, SimTask, SimUnitState, SimWorld } from './types';
import { invAdd, invCanAdd, invRatio, invTotal } from '../systems/inventory';
import { atkBonus, emptySkills, gainSkill, harvestBonus, refreshCapacity } from '../systems/skills';
import {
  atkFromAttr, defBonusOf, emptyAttrs, gainAttrXp, incomingDamage,
  isHungerPenalty, isStaminaLow, staminaCap, vitalityCap,
} from '../systems/attributes';
import { logMsg } from '../systems/log';
import {
  rollPersonality, findIdleWork, decideWolfReaction, moodStep, speedMoodMultiplier, workMoodMultiplier,
  MOOD_LOG, QUIPS_WORK, QUIPS_WOLF, QUIPS_NIGHT, QUIP_HUNGER, type IdleTarget,
} from '../systems/personality';
import type { Mood, Personality } from '../types';

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
  /** 角色 AI（spec 011）：性格/情绪，与前端 entities/unit.ts 同构，创建时由 world 注入确定性随机 */
  personality: Personality = rollPersonality(0, 0, 0);
  mood: Mood = 'neutral';
  private _moodT = 0;
  private _idleT = 0;
  private _downcastT = 0;

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
    // 情绪移动倍率（spec 011：害怕 ×0.8、疲惫 ×0.9；与前端同源 moodStep）
    if (this.role === 'player') slow *= speedMoodMultiplier(this.mood);
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
    // spec 011：被狼咬 → 害怕（同前端：变化才记日志）
    if (attacker?.role === 'wolf' && this.role === 'player' && this.mood !== 'fear') {
      this.mood = 'fear';
      logMsg(this.name + MOOD_LOG.fear);
    }
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
    // 角色 AI（spec 011）：情绪 tick + 闲时自治（顺序同前端：先找活后遇狼反应）
    if (this.role === 'player') {
      this.moodTick(world, dt);
      if (!this.task && !this.down) {
        this._idleT += dt;
        if (this._idleT >= CFG.idleScanInterval) {
          this._idleT = 0;
          this._tryIdleWork(world);
          this._checkWolfReaction(world);
        }
      }
    }
  }

  /** 情绪 tick（1 秒采样，前后端共用 moodStep 纯状态机；随机数走 world.rng 保确定性） */
  moodTick(world: SimWorld, dt: number): void {
    if (this.dead) return;
    this._moodT += dt;
    if (this._moodT < 1) return;
    this._moodT = 0;
    let wolfNear = false;
    for (const wl of world.wolves) {
      if (wl.dead || wl.down) continue;
      if (this.dist2(wl.x, wl.z) < CFG.wolfAutoEngageDist) { wolfNear = true; break; }
    }
    let sawDownedAlly = false;
    let allyNear = false;
    for (const p of world.players) {
      if (p === this || p.dead) continue;
      const d = this.dist2(p.x, p.z);
      if (p.down && d < CFG.witnessDownDist) sawDownedAlly = true;
      if (!p.down && d <= 10) allyNear = true;
    }
    const nearMarket = Math.hypot(this.x - world.merchant.x, this.z - world.merchant.z) < CFG.moodFearRadius;
    const res = moodStep(
      {
        mood: this.mood, trait: this.personality.trait,
        hunger: this.hunger, stamina: this.attrs.stamina,
        nearMarket, night: world.isNight, wolfNear, allyNear, sawDownedAlly,
        working: this.task?.type === 'gather',
        berryCount: this.inv.berry ?? 0, downcastT: this._downcastT,
      },
      world.rng.next(),
    );
    this.mood = res.mood;
    this._downcastT = res.downcastT;
    for (const ev of res.events) {
      if (ev === 'moodChanged') { if (MOOD_LOG[res.mood]) logMsg(this.name + MOOD_LOG[res.mood]); }
      else if (ev === 'quipWork') logMsg(this.name + '：' + QUIPS_WORK[Math.floor(world.rng.next() * QUIPS_WORK.length)]);
      else if (ev === 'quipWolf') logMsg(this.name + '：' + QUIPS_WOLF[Math.floor(world.rng.next() * QUIPS_WOLF.length)]);
      else if (ev === 'quipNight') logMsg(this.name + '：' + QUIPS_NIGHT[Math.floor(world.rng.next() * QUIPS_NIGHT.length)]);
      else if (ev === 'quipHunger') logMsg(this.name + '：' + QUIP_HUNGER);
      else if (ev === 'eatBerry') this._eatBerrySelf();
    }
  }

  /** 吃货自主啃食（同前端 _eatBerrySelf） */
  private _eatBerrySelf(): void {
    if ((this.inv.berry ?? 0) <= 0) return;
    this.inv.berry = (this.inv.berry ?? 0) - 1;
    this.hunger = Math.min(100, this.hunger + CFG.eatHeal);
    logMsg(this.name + ' 偷偷啃了颗浆果，饥饿 +' + CFG.eatHeal);
  }

  /** 闲时找活（同前端 _tryIdleWork：背包满停、lazy 跳过由 findIdleWork 内部保证） */
  private _tryIdleWork(world: SimWorld): void {
    if (invRatio(this) >= 1) return;
    const targets: IdleTarget[] = [];
    for (const t of world.trees) if (t.alive && t.phase === 'mature') targets.push({ kind: 'tree', x: t.x, z: t.z }); // 幼树免砍门（同前端）
    for (const r of world.rocks) if (r.alive) targets.push({ kind: 'rock', x: r.x, z: r.z });
    for (const b of world.berries) if (b.alive) targets.push({ kind: 'berry', x: b.x, z: b.z });
    const leader = world.players.find((p) => !p.down && !p.dead) ?? this;
    const found = findIdleWork(this.personality.work, leader.x, leader.z, targets, CFG.idleScanRadius);
    if (!found) return;
    const list: { x: number; z: number; alive: boolean }[] =
      found.kind === 'tree' ? world.trees : found.kind === 'rock' ? world.rocks : world.berries;
    const idx = list.findIndex((e) => e.alive && e.x === found.x && e.z === found.z);
    if (idx < 0) return;
    const dx = found.x - this.x;
    const dz = found.z - this.z;
    const dist = Math.hypot(dx, dz) || 1;
    const k = Math.min(dist, 1.5) / dist;
    this.task = {
      type: 'gather', kind: found.kind, target: idx,
      pos: { x: this.x + dx * k, z: this.z + dz * k },
      workT: 0, workDur: found.kind === 'tree' ? 2.2 : found.kind === 'rock' ? 1.6 : 1.2,
    };
  }

  /** 狼来了性格反应（同前端 _checkWolfReaction：engage 追击 / flee 跑向最近队友 / wait 不动） */
  private _checkWolfReaction(world: SimWorld): void {
    let nearest: SimUnit | null = null;
    let ni = -1;
    let nd: number = CFG.wolfAutoEngageDist;
    for (let i = 0; i < world.wolves.length; i++) {
      const wl = world.wolves[i];
      if (wl.dead || wl.down) continue;
      const d = this.dist2(wl.x, wl.z);
      if (d < nd) { nd = d; nearest = wl; ni = i; }
    }
    if (nearest === null || ni < 0) return;
    const reaction = decideWolfReaction(this.personality.combat, nd, this.hp / this.maxHp);
    if (reaction === 'engage') {
      this.task = { type: 'attack', target: ni, targetRole: 'wolf', pos: { x: nearest.x, z: nearest.z }, workT: 0 };
    } else if (reaction === 'flee') {
      const ally = world.players.find((p) => p !== this && !p.down && !p.dead) ?? world.players.find((p) => !p.dead);
      this.task = { type: 'move', pos: { x: ally ? ally.x : this.x, z: ally ? ally.z : this.z }, workT: 0 };
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
        // 饥饿 ≤20 → 采集变慢（×0.9）；情绪工作倍率（spec 011，同前端）
        t.workT += dt * (isHungerPenalty(this.hunger) ? CFG.hungerWorkSlow : 1) * workMoodMultiplier(this.mood);
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
      if (!tree || !tree.alive || tree.phase !== 'mature') { this.task = null; return; } // 非成树不可结算（免砍门）
      const sp = TREES[tree.species];
      if (!invCanAdd(this, 'wood', sp.wood)) {
        logMsg(this.name + ' 背包已满，放不下更多木材');
        this.task = null;
        return;
      }
      invAdd(this, 'wood', sp.wood);
      tree.alive = false;
      tree.phase = 'stump';
      tree.respawn = TREE_STUMP;
      gainSkill(this, 'gather', 1);
      refreshCapacity(this); // 采集升级 → 负重立即 +4
      logMsg('砍倒' + sp.name + '，木材 +' + sp.wood);
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
