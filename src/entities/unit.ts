/**
 * Wilderlands · 单位实体
 * 拓荒者与野狼共用一套血量/任务/移动机制（部位化身体状态）。
 * v0.2: 低多边形分段模型 + 程序化动画
 */
import * as THREE from 'three';
import { ANIM, CFG, ITEMS, PALETTE, START_INV, UNIT_NAMES } from '../config';
import type { AnimState, BerryEnt, Inventory, LimbRefs, Personality, Mood, RockEnt, Tile, TreeEnt, Unit, UnitRole, UnitTask } from '../types';
import { rollPersonality, findIdleWork, decideWolfReaction, speedMoodMultiplier, workMoodMultiplier, type IdleTarget, type WolfReaction } from '../systems/personality';
import { buildings, interMeshes, logMsg, players, rocks, berries, removeSelected, selected, selectableMeshes, trees, wolves } from '../state';
import { invAdd, invCanAdd, invRatio } from '../systems/inventory';
import { plantTile } from '../systems/farm';
import { atkBonus, capacityBonus, emptySkills, gainSkill, harvestBonus, refreshCapacity } from '../systems/skills';
import {
  atkFromAttr, emptyAttrs, gainAttrXp, incomingDamage,
  isHungerPenalty, isStaminaLow, staminaCap, vitalityCap,
} from '../systems/attributes';
import { scene } from '../core/renderer';
import { groundHeightAt, regInter, tileMats } from '../core/world';

/** 通用底座（接触阴影） */
function shadowPad(r: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r + 0.1, 0.06, 10),
    new THREE.MeshLambertMaterial({ color: PALETTE.shadowPad }),
  );
  m.position.y = 0.03;
  return m;
}

export class PioneerUnit implements Unit {
  role: UnitRole;
  name: string;
  hp: number;
  maxHp: number;
  hunger: number;
  pos: THREE.Vector3;
  speed: number;
  targetPos: THREE.Vector3 | null = null;
  task: UnitTask | null = null;
  down = false;
  downT = 0;
  atkT = 0;
  facing = 0;
  selected = false;
  dead = false;
  atkDmg: number = CFG.atkDmg;
  hasSpear = false;
  inv: Inventory = {};
  skills = emptySkills();
  capacity: number = CFG.inventoryCap;
  limbs = { 头: 100, 躯干: 100, 左臂: 100, 右臂: 100, 左腿: 100, 右腿: 100 };
  personality: Personality = rollPersonality(Math.random(), Math.random(), Math.random());
  mood: Mood = 'neutral';
  private _idleT = 0;       // 闲时扫描计时器
  private _moodT = 0;       // 情绪更新计时器
  private _downcastT = 0;   // 低落剩余时间
  mesh: THREE.Group;
  wanderT = 0;
  wanderPos: THREE.Vector3 | null = null;
  attackT = 0;

  private _bodyMat: THREE.MeshLambertMaterial;
  private _marker: THREE.Mesh;
  private _limbs: LimbRefs = {};
  private _toolHandle: THREE.Mesh | null = null;
  private _toolHead: THREE.Mesh | null = null;
  private _animT = 0;       // 动画相位（仅动作状态推进）
  private _blend = 0;       // 姿态混合：0=自然站立，1=走路摆动幅度（平滑过渡，避免站走跳变）
  private _animState: AnimState = 'idle';
  attrs = emptyAttrs();
  moveXpT = 0;

  constructor(role: UnitRole, x: number, z: number, name?: string) {
    this.role = role;
    this.hp = role === 'wolf' ? CFG.wolfHp : 100;
    this.maxHp = this.hp;
    this.hunger = 100;
    const groundY = groundHeightAt(x, z);
    this.pos = new THREE.Vector3(x, groundY, z);
    this.speed = role === 'wolf' ? CFG.wolfSpeed : CFG.playerSpeed;
    this.name = name ?? (role === 'player' ? UNIT_NAMES[players.length % 3] : '野狼');
    // 拓荒者初始背包；野狼/招募第 4 人空背包
    this.inv = role === 'player' && players.length < 3 ? { ...START_INV } : {};
    // 负重上限 = 基础容量 + 采集技能加成
    refreshCapacity(this);

    const color =
      role === 'wolf'
        ? PALETTE.wolfFur
        : PALETTE.unitColors[players.length % PALETTE.unitColors.length];

    this.mesh = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const darkMat = new THREE.MeshLambertMaterial({ color: PALETTE.unitDark });
    const skinMat = new THREE.MeshLambertMaterial({ color: PALETTE.unitSkin });

    if (role === 'wolf') {
      this._buildWolf(bodyMat, darkMat);
    } else {
      this._buildPioneer(bodyMat, darkMat, skinMat);
    }

    this.mesh.add(shadowPad(0.62));

    // 选中标记（头顶金色旋转菱形）
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 4),
      new THREE.MeshLambertMaterial({ color: PALETTE.markerGold, emissive: 0x8a6a10 }),
    );
    marker.position.y = 2.55;
    marker.visible = false;
    this.mesh.add(marker);
    this._marker = marker;

    if (role === 'player') this.mesh.scale.set(1.0, 1.0, 1.0);
    this.mesh.position.copy(this.pos);
    this.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        if (role === 'player') {
          m.userData.unit = this;
          selectableMeshes.push(m);
        }
      }
    });
    scene.add(this.mesh);

    // 野狼注册为可交互目标（右键攻击 + 悬停提示）
    if (role === 'wolf') regInter(this.mesh, { kind: 'wolf', ent: this });

    this._bodyMat = bodyMat;

    if (role === 'player') players.push(this);
    else wolves.push(this);
  }

  /** 构建拓荒者模型（分段低多边形，四肢按真实骨骼层级挂载） */
  private _buildPioneer(bodyMat: THREE.MeshLambertMaterial, darkMat: THREE.MeshLambertMaterial, skinMat: THREE.MeshLambertMaterial): void {
    // 躯干：胶囊体
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 8), bodyMat);
    torso.position.y = 1.1;
    this._limbs.torso = torso;

    // 头（挂在躯干下，随身体起伏，避免走路上身分离）
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), skinMat);
    head.position.y = 0.68; // 1.78 - 1.1（躯干局部坐标）
    this._limbs.head = head;

    // 帽子（跟头走）
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.18, 6), bodyMat);
    hat.position.y = 0.88; // 1.98 - 1.1
    torso.add(head, hat);

    // 上臂（左右，pivot 在肩部）
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.26, 4, 6), bodyMat);
    armL.position.set(-0.42, 1.35, 0);
    armL.geometry.translate(0, -0.13, 0); // pivot 在肩部

    const armR = armL.clone();
    armR.position.x = 0.42;

    // 下臂（小臂，挂在上臂下，随上臂摆动；pivot 在肘部）
    const forearmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.24, 4, 6), skinMat);
    forearmL.position.y = -0.33; // 1.02 - 1.35（上臂局部坐标）
    forearmL.geometry.translate(0, -0.12, 0);

    const forearmR = forearmL.clone();
    armL.add(forearmL);
    armR.add(forearmR);

    // 大腿（左右，pivot 在髋部）
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.28, 4, 6), darkMat);
    legL.position.set(-0.16, 0.62, 0);
    legL.geometry.translate(0, -0.14, 0); // pivot 在髋部

    const legR = legL.clone();
    legR.position.x = 0.16;

    // 小腿（挂在大腿下，随大腿摆动；pivot 在膝部）
    const calfL = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.26, 4, 6), darkMat);
    calfL.position.y = -0.32; // 0.3 - 0.62（大腿局部坐标）
    calfL.geometry.translate(0, -0.13, 0);

    const calfR = calfL.clone();
    legL.add(calfL);
    legR.add(calfR);

    // 工具（挂在右手下，挥砍时随右臂举起）
    const tool = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6),
      new THREE.MeshLambertMaterial({ color: PALETTE.toolHandle }),
    );
    handle.position.y = 0.7;
    const toolHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.3, 0.1),
      new THREE.MeshLambertMaterial({ color: PALETTE.toolHead }),
    );
    toolHead.position.y = 1.4;
    tool.add(handle, toolHead);
    tool.position.set(0, -0.4, 0.1); // 相对右肩：0.95 - 1.35
    tool.rotation.z = 0.2;
    armR.add(tool);
    this._toolHandle = handle;
    this._toolHead = toolHead;

    this.mesh.add(torso, armL, armR, legL, legR);

    this._limbs.armL = armL;
    this._limbs.armR = armR;
    this._limbs.forearmL = forearmL;
    this._limbs.forearmR = forearmR;
    this._limbs.legL = legL;
    this._limbs.legR = legR;
    this._limbs.calfL = calfL;
    this._limbs.calfR = calfR;
  }

  /** 构建野狼模型（四足低多边形） */
  private _buildWolf(bodyMat: THREE.MeshLambertMaterial, darkMat: THREE.MeshLambertMaterial): void {
    // 身体：横放胶囊体
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.75;
    this._limbs.torso = body;

    // 头
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), bodyMat);
    head.position.set(0, 0.95, 0.55);

    // 口鼻
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 5), darkMat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.9, 0.82);

    // 耳朵
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), darkMat);
    earL.position.set(-0.12, 1.15, 0.45);
    const earR = earL.clone();
    earR.position.x = 0.12;

    // 眼睛（发光）
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.05, 0.03),
      new THREE.MeshLambertMaterial({ color: PALETTE.wolfEye, emissive: 0x881100 }),
    );
    eye.position.set(0.1, 0.98, 0.72);
    const eye2 = eye.clone();
    eye2.position.x = -0.1;

    // 四条腿（前左/前右/后左/后右）
    const legGeo = new THREE.CapsuleGeometry(0.06, 0.32, 4, 6);
    legGeo.translate(0, -0.16, 0); // pivot 在肩部

    const frontL = new THREE.Mesh(legGeo, darkMat);
    frontL.position.set(-0.18, 0.7, 0.45);
    const frontR = frontL.clone();
    frontR.position.x = 0.18;

    const backL = new THREE.Mesh(legGeo, darkMat);
    backL.position.set(-0.18, 0.7, -0.45);
    const backR = backL.clone();
    backR.position.x = 0.18;

    // 尾巴
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 5), darkMat);
    tail.position.set(0, 0.95, -0.65);
    tail.rotation.x = -0.6;

    this.mesh.add(body, head, snout, earL, earR, eye, eye2, frontL, frontR, backL, backR, tail);

    this._limbs.legL = frontL;   // 前左
    this._limbs.legR = frontR;   // 前右
    this._limbs.calfL = backL;  // 后左
    this._limbs.calfR = backR;   // 后右
  }

  setSelect(v: boolean): void {
    this.selected = v;
    this._marker.visible = v;
    // 选中时不改模型颜色，只保留头顶标记
  }

  /** 选中标记旋转（主循环驱动） */
  markerTick(dt: number): void {
    if (this._marker.visible) this._marker.rotation.y += dt * 3;
  }

  /** 装备木矛：攻击提升 + 持械外观变化 */
  equipSpear(): void {
    if (this.hasSpear) {
      logMsg(this.name + ' 已经握着木矛了');
      return;
    }
    this.hasSpear = true;
    this.atkDmg = CFG.atkDmg + CFG.spearAtk;
    if (this._toolHandle) this._toolHandle.scale.set(1, 1.6, 1); // 加长矛杆
    if (this._toolHead) {
      this._toolHead.scale.set(1.7, 1.7, 1.7); // 加宽矛尖
      (this._toolHead.material as THREE.MeshLambertMaterial).color.setHex(PALETTE.spearTip);
    }
    logMsg(this.name + ' 装备木矛，攻击 +' + CFG.spearAtk);
  }

  lookAtTarget(p: THREE.Vector3): void {
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) this.facing = Math.atan2(dx, dz);
  }

  moveToward(p: THREE.Vector3, dt: number): boolean {
    // 平面距离判定到达：pos.y 每帧跟随地面（groundHeightAt），目标点 p.y 与脚下高度
    // 常不一致，若用 3D 距离，地形起伏会让角色永远"到不了"而一直走（S5 实测发现）。
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    let slow = this.hunger < 30 ? 0.5 : 1;
    // 负重超载减速（P2）
    if (invRatio(this) >= CFG.overloadRatio) slow *= CFG.overloadSlow;
    // 体力告急减速（spec 010：≤20% → ×0.8）
    if (isStaminaLow(this)) slow *= 0.8;
    // 情绪减速（spec 011）
    slow *= speedMoodMultiplier(this.mood);
    if (d > 0.2) {
      const dir = p.clone().sub(this.pos);
      dir.y = 0;
      dir.normalize();
      this.pos.add(dir.multiplyScalar(this.speed * slow * dt));
      // Y 坐标跟随地面
      this.pos.y = groundHeightAt(this.pos.x, this.pos.z);
      this.mesh.position.copy(this.pos);
      this.lookAtTarget(p);
      this.mesh.rotation.y = this.facing;
      this._animState = 'walk';
      // 跑动消耗体力；每跑 10 秒涨 1 体力经验
      this.attrs.stamina = Math.max(0, this.attrs.stamina - CFG.staminaMoveCost * dt);
      this.moveXpT += dt;
      if (this.moveXpT >= 10 - 1e-6) { this.moveXpT -= 10; gainAttrXp(this, 'staminaXp', 1); }
      return true;
    }
    this._animState = 'idle';
    return false;
  }

  takeDamage(dmg: number, attacker?: Unit, pierce = false): void {
    if (this.down) return;
    // 防御减伤只对攻击生效（max(1, dmg-defLv)）；饥饿等持续掉血走 pierce 原样扣
    const dmgIn = pierce ? dmg : incomingDamage(dmg, this);
    if (attacker?.role === 'wolf') gainAttrXp(this, 'defXp', 1);
    // spec 011：被狼咬 → 害怕
    if (attacker?.role === 'wolf' && this.role === 'player') {
      this.mood = 'fear';
    }
    this.hp = Math.max(0, this.hp - dmgIn);
    if (this.hp <= 0) {
      this.down = true;
      this.downT = 0;
      this.mesh.rotation.x = Math.PI / 2;
      this.task = null;
      this.targetPos = null;
      removeSelected(this);
      if (this.role === 'player') logMsg(this.name + ' 倒下了，等待恢复…');
      else {
        this.dead = true;
        // 战利品与战斗经验进击杀者（装不下则不产出）
        if (attacker && attacker.role === 'player') {
          invAdd(attacker, 'food', 2);
          gainSkill(attacker, 'combat', 3);
        }
        logMsg('击败野狼，食物 +2');
      }
    }
  }

  /** 动画驱动（每帧调用） */
  private _updateAnimation(dt: number): void {
    if (this.down || this.dead) return;

    // 姿态混合：走路时四肢摆动幅度渐入，静止时平滑收回自然站立——站走切换无跳变
    const legTarget = this._animState === 'walk' ? 1 : 0;
    if (this._blend < legTarget) this._blend = Math.min(legTarget, this._blend + dt * ANIM.blendSpeed);
    else if (this._blend > legTarget) this._blend = Math.max(legTarget, this._blend - dt * ANIM.blendSpeed);

    // 相位推进：走路/采集/攻击时驱动，idle 停住（配合 blend 收腿回自然站姿）
    if (this._animState !== 'idle') {
      const speed =
        this._animState === 'gather' ? ANIM.gatherSpeed
        : this._animState === 'attack' ? ANIM.gatherSpeed * 1.5
        : ANIM.walkSpeed;
      this._animT += dt * speed;
    }
    const t = this._animT;
    const swing = ANIM.walkSwing * this._blend;
    const bobAmp = ANIM.bobHeight * this._blend;

    if (this.role === 'player') {
      // 大腿交替摆动
      if (this._limbs.legL) this._limbs.legL.rotation.x = Math.sin(t) * swing;
      if (this._limbs.legR) this._limbs.legR.rotation.x = Math.sin(t + Math.PI) * swing;
      // 小腿（挂在大腿下）：迈步（前摆）时膝盖弯曲向后折，蹬地（后摆）时伸直
      if (this._limbs.calfL) this._limbs.calfL.rotation.x = Math.max(0, -Math.sin(t)) * swing * ANIM.kneeBend * 2;
      if (this._limbs.calfR) this._limbs.calfR.rotation.x = Math.max(0, Math.sin(t)) * swing * ANIM.kneeBend * 2;
      // 手臂反相摆动，小臂跟随自然微弯
      if (this._limbs.armL) this._limbs.armL.rotation.x = Math.sin(t + Math.PI) * swing * 0.7;
      if (this._limbs.armR) this._limbs.armR.rotation.x = Math.sin(t) * swing * 0.7;
      if (this._limbs.forearmL) this._limbs.forearmL.rotation.x = Math.sin(t + Math.PI) * swing * 0.7 * ANIM.elbowBend;
      if (this._limbs.forearmR) this._limbs.forearmR.rotation.x = Math.sin(t) * swing * 0.7 * ANIM.elbowBend;
      // 身体上下起伏（头挂在躯干下，自动跟随，不再头身分离）
      if (this._limbs.torso) this._limbs.torso.position.y = 1.1 + Math.abs(Math.sin(t)) * bobAmp;
    } else {
      // 狼：对角跑（前左+后右同相，前右+后左反相）
      if (this._limbs.legL) this._limbs.legL.rotation.x = Math.sin(t) * swing;
      if (this._limbs.calfR) this._limbs.calfR.rotation.x = Math.sin(t) * swing;
      if (this._limbs.legR) this._limbs.legR.rotation.x = Math.sin(t + Math.PI) * swing;
      if (this._limbs.calfL) this._limbs.calfL.rotation.x = Math.sin(t + Math.PI) * swing;
      if (this._limbs.torso) this._limbs.torso.position.y = 0.75 + Math.abs(Math.sin(t)) * bobAmp * 0.5;
    }

    // 采集/攻击：右手（持工具侧）举过头顶再落下的挥砍循环
    if (this._animState === 'gather' || this._animState === 'attack') {
      const g = Math.sin(t * 0.8) * ANIM.gatherSwing;
      if (this._limbs.armR) this._limbs.armR.rotation.x = -g;
      if (this._limbs.forearmR) this._limbs.forearmR.rotation.x = -g * 0.3;
    }
  }

  update(dt: number): void {
    if (this.dead) return;

    // 动画驱动
    this._updateAnimation(dt);

    // 倒地恢复
    if (this.down) {
      this.downT += dt;
      if (this.downT >= CFG.downRecover) {
        this.down = false;
        this.mesh.rotation.x = 0;
        this.hp = Math.max(this.hp, 50);
        if (this.role === 'player') {
          logMsg(this.name + ' 苏醒了');
          gainAttrXp(this, 'vitalityXp', 1); // 大难不死，生命力见长
        }
      }
      return;
    }

    // 饥饿
    if (this.role === 'player') {
      this.hunger = Math.max(0, this.hunger - CFG.hungerRate * dt);
      if (this.hunger <= 0) this.takeDamage(1 * dt, undefined, true);
    }

    // 闲时自治（spec 011）：无任务时按性格在领队附近找活
    if (this.role === 'player' && !this.task && !this.down && !this.dead) {
      this._idleT += dt;
      if (this._idleT >= CFG.idleScanInterval) {
        this._idleT = 0;
        this._tryIdleWork();
        this._checkWolfReaction();
      }
    }

    // 情绪更新（spec 011）
    this._updateMood(dt);

    // 任务执行
    const t = this.task;
    if (t) {
      if (t.type === 'move' || t.type === 'walk') {
        if (!this.moveToward(t.pos!, dt)) this.task = null;
      } else if (t.type === 'gather') {
        if (!this.moveToward(t.pos!, dt)) {
          // 饥饿 ≤20 → 采集变慢（×0.9）；情绪再叠一层
          t.workT += dt * (isHungerPenalty(this.hunger) ? CFG.hungerWorkSlow : 1) * workMoodMultiplier(this.mood);
          this._animState = 'gather';
          if (t.workT >= (t.workDur ?? 2)) this._finishGather(t);
        }
      } else if (t.type === 'attack') {
        const w = t.target as Unit;
        if (!w || w.dead || w.down) {
          this.task = null;
          return;
        }
        // 攻击距离也用平面距离（同 moveToward 口径，避免地形高度差导致"打不到/追不停"）
        const dist = Math.hypot(w.pos.x - this.pos.x, w.pos.z - this.pos.z);
        if (dist > 1.9) {
          // 先走到自己的站位点；到位后若目标仍在射程外，再直接追击
          const dest = this.targetPos;
          if (dest && Math.hypot(dest.x - this.pos.x, dest.z - this.pos.z) > 0.3) {
            this.moveToward(dest, dt);
          } else {
            this.moveToward(w.pos, dt);
          }
        } else {
          this.lookAtTarget(w.pos);
          this.mesh.rotation.y = this.facing;
          this.atkT -= dt;
          if (this.atkT <= 0) {
            this.atkT = CFG.atkCd;
            this._swing();
            // 攻击属性加成 + 饥饿 ≤20 → 攻击 -1（spec 010）
            const dmg = this.atkDmg + atkFromAttr(this) + atkBonus(this)
              - (isHungerPenalty(this.hunger) ? CFG.hungerAtkPenalty : 0);
            w.takeDamage(dmg, this);
            if (w.role === 'wolf') {
              gainAttrXp(this, 'atkXp', 1); // 命中狼练攻击
              this.attrs.stamina = Math.max(0, this.attrs.stamina - CFG.staminaAtkCost);
            }
          }
        }
      } else if (t.type === 'trade') {
        if (!this.moveToward(t.pos!, dt)) {
          t.workT += dt;
          if (t.workT >= 1.2) {
            this.task = null;
            this._onTradeReady(this);
          }
        }
      }
    }

    // 木屋回血
    if (this.role === 'player') {
      for (const b of buildings) {
        if (b.type === 'house' && this.pos.distanceTo(b.mesh.position) < 6) {
          this.hp = Math.min(vitalityCap(this), this.hp + 5 * dt);
          break;
        }
      }
    }
  }

  /** 闲时找活：按性格在领队附近自动采集 */
  private _tryIdleWork(): void {
    if (invRatio(this) >= 1) return; // 背包满了不找活
    const leader = selected[0] ?? this;
    const targets: IdleTarget[] = [];
    for (const t of trees) if (t.alive) targets.push({ kind: 'tree', x: t.p.x, z: t.p.z });
    for (const r of rocks) if (r.alive) targets.push({ kind: 'rock', x: r.p.x, z: r.p.z });
    for (const b of berries) if (b.alive) targets.push({ kind: 'berry', x: b.p.x, z: b.p.z });
    const found = findIdleWork(this.personality.work, leader.pos.x, leader.pos.z, targets, CFG.idleScanRadius);
    if (!found) return;
    // 走到目标旁边开始采集
    const dx = found.x - this.pos.x;
    const dz = found.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const tx = this.pos.x + (dx / dist) * Math.min(dist, 1.5);
    const tz = this.pos.z + (dz / dist) * Math.min(dist, 1.5);
    this.task = {
      type: 'gather',
      kind: found.kind === 'tree' ? 'tree' : found.kind === 'rock' ? 'rock' : 'berry',
      target: found.kind === 'tree' ? trees.find((t) => t.p.x === found.x && t.p.z === found.z)
            : found.kind === 'rock' ? rocks.find((r) => r.p.x === found.x && r.p.z === found.z)
            : berries.find((b) => b.p.x === found.x && b.p.z === found.z),
      pos: new THREE.Vector3(tx, 0, tz),
      workT: 0,
      workDur: found.kind === 'tree' ? 2.2 : found.kind === 'rock' ? 1.6 : 1.2,
    };
  }

  /** 情绪更新（spec 011）：每 1 秒检查触发与消退 */
  private _updateMood(dt: number): void {
    if (this.role !== 'player' || this.dead) return;
    this._moodT += dt;
    if (this._moodT < 1) return;
    this._moodT = 0;

    // 低落倒计时
    if (this.mood === 'downcast') {
      this._downcastT -= 1;
      if (this._downcastT <= 0) this.mood = 'neutral';
    }

    // 触发：饥饿 → 烦躁
    if (this.hunger <= 20 && this.mood === 'neutral') {
      this.mood = 'irritable';
      if (this.personality.trait === 'talkative') logMsg(this.name + '：我都快饿死了还折腾…');
      return;
    }
    // 话痨随机吐槽（干活时偶尔冒一句）
    if (this.personality.trait === 'talkative' && this.task?.type === 'gather' && Math.random() < CFG.moodTalkChance) {
      const quips = [
        this.name + '：这棵树长得还挺结实。',
        this.name + '：手都磨出茧了…',
        this.name + '：今天天气不错，就是有点忙。',
      ];
      logMsg(quips[Math.floor(Math.random() * quips.length)]);
    }
    // 触发：体力低 → 疲惫
    if (this.attrs.stamina <= 20 && this.mood === 'neutral') {
      this.mood = 'exhausted';
      return;
    }
    // 消退：吃了东西消除烦躁
    if (this.mood === 'irritable' && this.hunger > 40) {
      this.mood = 'neutral';
    }
    // 消退：休息够了消除疲惫
    if (this.mood === 'exhausted' && this.attrs.stamina > 40) {
      this.mood = 'neutral';
    }
    // 消退：害怕——回到商摊 15 米内
    if (this.mood === 'fear') {
      const dx = this.pos.x - 4; // merchantPos ≈ (4, 0, 16)
      const dz = this.pos.z - 16;
      if (Math.hypot(dx, dz) < CFG.moodFearRadius) this.mood = 'neutral';
    }
  }

  /** 狼来了性格反应（spec 011）：无任务时按性格决定主动打/跑/观望 */
  private _checkWolfReaction(): void {
    if (this.role !== 'player' || this.task || this.down || this.dead) return;
    // 找最近的狼
    let nearest: Unit | null = null;
    let nd = CFG.wolfAutoEngageDist;
    for (const w of wolves) {
      if (w.dead || w.down) continue;
      const d = Math.hypot(w.pos.x - this.pos.x, w.pos.z - this.pos.z);
      if (d < nd) { nd = d; nearest = w; }
    }
    if (!nearest) return;
    const reaction = decideWolfReaction(this.personality.combat, nd, this.hp / this.maxHp);
    if (reaction === 'engage') {
      this.task = { type: 'attack', target: nearest, workT: 0 };
    } else if (reaction === 'flee') {
      // 跑向领队
      const leader = selected[0] ?? this;
      this.task = { type: 'move', pos: leader.pos.clone(), workT: 0 };
    }
    // cautious → wait，不做任何事
  }

  /** 交易完成回调（带角色自身，由 ui/trade 注入：走到商摊后打开面板并锁定交易对象） */
  private _onTradeReady: (u: Unit) => void = () => {};

  setTradeCallback(fn: (u: Unit) => void): void {
    this._onTradeReady = fn;
  }

  private _swing(): void {
    this._animState = 'attack';
    setTimeout(() => {
      this._animState = 'idle';
    }, 200);
  }

  private _finishGather(t: UnitTask): void {
    this._animState = 'idle';
    // 采集消耗体力 + 涨体力经验（spec 010：体力=每天的干活预算）
    this.attrs.stamina = Math.max(0, this.attrs.stamina - (t.kind === 'crop' ? CFG.staminaFarmCost : CFG.staminaWorkCost));
    gainAttrXp(this, 'staminaXp', 1);
    if (t.kind === 'tree') {
      const tree = t.target as TreeEnt;
      // 背包装不下就不砍，资源保留在原位
      if (!invCanAdd(this, 'wood', CFG.woodPerTree)) {
        logMsg(this.name + ' 背包已满，放不下更多木材');
        this.task = null;
        return;
      }
      invAdd(this, 'wood', CFG.woodPerTree);
      tree.alive = false;
      tree.respawn = 45;
      tree.mesh.visible = false;
      gainSkill(this, 'gather', 1);
      refreshCapacity(this); // 采集升级 → 负重立即 +4（修复：游戏中升级即时生效）
      logMsg('砍倒树木，木材 +' + CFG.woodPerTree);
      // 取消所有正在采这棵树的角色任务
      for (const u of [...players, ...wolves]) {
        if (u.task?.type === 'gather' && u.task.target === tree) {
          u.task = null;
        }
      }
    } else if (t.kind === 'rock') {
      const rock = t.target as RockEnt;
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
        rock.mesh.visible = false;
        logMsg('矿脉采空了');
        // 取消所有正在凿这块石头的角色任务
        for (const u of [...players, ...wolves]) {
          if (u.task?.type === 'gather' && u.task.target === rock) {
            u.task = null;
          }
        }
      }
    } else if (t.kind === 'crop') {
      const tile = t.target as Tile;
      if (tile.state !== 3) {
        // 被其他角色抢先收获，取消本次任务
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
      tile.mesh.material = tileMats[0];
      tile.mesh.visible = false;
      tile.ear.visible = false;
      gainSkill(this, 'farm', 1);
      logMsg('收获作物，食物 +' + gain);
    } else if (t.kind === 'sow') {
      const tile = t.target as Tile;
      // 走到田边后播种（plantTile 内部会校验 state=0 和种子）
      plantTile(tile, this);
    } else if (t.kind === 'berry') {
      const berry = t.target as BerryEnt;
      if (!invCanAdd(this, 'berry', CFG.berryFood)) {
        logMsg(this.name + ' 背包已满，放不下更多浆果');
        this.task = null;
        return;
      }
      invAdd(this, 'berry', CFG.berryFood);
      berry.alive = false;
      berry.respawn = CFG.berryRespawn;
      berry.mesh.visible = false;
      gainSkill(this, 'gather', 1);
      refreshCapacity(this);
      logMsg('采集浆果，浆果 +' + CFG.berryFood);
      for (const u of [...players, ...wolves]) {
        if (u.task?.type === 'gather' && u.task.target === berry) {
          u.task = null;
        }
      }
    }
    this.task = null;
  }
}

/** 创建 3 人拓荒小队 */
export function createPlayers(): void {
  for (let i = 0; i < 3; i++) {
    new PioneerUnit('player', (i - 1) * 1.6, 1.2 + i * 0.3);
  }
}
