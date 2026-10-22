/**
 * Wilderlands · 单位实体
 * 拓荒者与野狼共用一套血量/任务/移动机制（Kenshi 风部位状态）。
 */
import * as THREE from 'three';
import { CFG, PALETTE, UNIT_NAMES } from '../config';
import type { RockEnt, Tile, TreeEnt, Unit, UnitRole, UnitTask } from '../types';
import { bag, buildings, logMsg, players, selectableMeshes, wolves } from '../state';
import { scene } from '../core/renderer';
import { tileMats } from '../core/world';

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
  limbs = { 头: 100, 躯干: 100, 左臂: 100, 右臂: 100, 左腿: 100, 右腿: 100 };
  mesh: THREE.Group;
  wanderT = 0;
  wanderPos: THREE.Vector3 | null = null;
  attackT = 0;

  private _torso: THREE.Mesh;
  private _bodyMat: THREE.MeshLambertMaterial;
  private _marker: THREE.Mesh;

  constructor(role: UnitRole, x: number, z: number) {
    this.role = role;
    this.hp = role === 'wolf' ? CFG.wolfHp : 100;
    this.maxHp = this.hp;
    this.hunger = 100;
    this.pos = new THREE.Vector3(x, 0, z);
    this.speed = role === 'wolf' ? CFG.wolfSpeed : CFG.playerSpeed;
    this.name = role === 'player' ? UNIT_NAMES[players.length % 3] : '野狼';

    const color =
      role === 'wolf'
        ? PALETTE.wolfFur
        : PALETTE.unitColors[players.length % 3];

    this.mesh = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const darkMat = new THREE.MeshLambertMaterial({ color: PALETTE.unitDark });
    const skinMat = new THREE.MeshLambertMaterial({ color: PALETTE.unitSkin });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.4), bodyMat);
    torso.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skinMat);
    head.position.y = 1.75;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), darkMat);
    legL.position.set(-0.16, 0.28, 0);
    legL.rotation.x = 0.04;
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), darkMat);
    legR.position.set(0.16, 0.28, 0);
    legR.rotation.x = -0.04;

    if (role === 'wolf') {
      // 红棕野狼：大耳 + 亮红眼 + 深色脊背
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.55), darkMat);
      tail.position.set(0, 1.1, -0.55);
      tail.rotation.x = -0.55;
      const earL = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 4), darkMat);
      earL.position.set(-0.16, 1.95, 0);
      const earR = earL.clone();
      earR.position.x = 0.16;
      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.06, 0.03),
        new THREE.MeshLambertMaterial({ color: PALETTE.wolfEye, emissive: 0x881100 }),
      );
      eye.position.set(0, 1.78, 0.24);
      const backStripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.62), darkMat);
      backStripe.position.set(0, 1.42, -0.05);
      this.mesh.add(tail, earL, earR, eye, backStripe);
      this.mesh.scale.set(1.0, 0.78, 1.3);
    } else {
      // 拓荒者：帽子 + 手里举工具
      const hat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.36, 0.22, 6),
        bodyMat,
      );
      hat.position.y = 1.98;
      const tool = new THREE.Group();
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6),
        new THREE.MeshLambertMaterial({ color: PALETTE.toolHandle }),
      );
      handle.position.y = 0.75;
      handle.rotation.z = 0.28;
      const toolHead = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.34, 0.1),
        new THREE.MeshLambertMaterial({ color: PALETTE.toolHead }),
      );
      toolHead.position.y = 1.5;
      toolHead.rotation.z = 0.28;
      tool.add(handle, toolHead);
      tool.position.set(0.55, 0.9, 0.05);
      this.mesh.add(hat, tool);
    }

    this.mesh.add(torso, head, legL, legR);
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

    if (role === 'player') this.mesh.scale.set(1.25, 1.25, 1.25);
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

    this._torso = torso;
    this._bodyMat = bodyMat;

    if (role === 'player') players.push(this);
    else wolves.push(this);
  }

  setSelect(v: boolean): void {
    this.selected = v;
    this._marker.visible = v;
    if (this.role === 'player') {
      this._bodyMat.color.setHex(
        v ? PALETTE.selectBlue : PALETTE.unitColors[players.indexOf(this) % 3],
      );
    }
  }

  /** 选中标记旋转（主循环驱动） */
  markerTick(dt: number): void {
    if (this._marker.visible) this._marker.rotation.y += dt * 3;
  }

  lookAtTarget(p: THREE.Vector3): void {
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) this.facing = Math.atan2(dx, dz);
  }

  moveToward(p: THREE.Vector3, dt: number): boolean {
    const d = this.pos.distanceTo(p);
    const slow = this.hunger < 30 ? 0.5 : 1;
    if (d > 0.2) {
      const dir = p.clone().sub(this.pos).normalize();
      this.pos.add(dir.multiplyScalar(this.speed * slow * dt));
      this.mesh.position.copy(this.pos);
      this.lookAtTarget(p);
      this.mesh.rotation.y = this.facing;
      return true;
    }
    return false;
  }

  takeDamage(dmg: number): void {
    if (this.down) return;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) {
      this.down = true;
      this.downT = 0;
      this.mesh.rotation.x = Math.PI / 2;
      this.task = null;
      this.targetPos = null;
      if (this.role === 'player') logMsg(this.name + ' 倒下了，等待恢复…');
      else {
        // 击败野狼，掉落
        this.dead = true;
        bag.food += 2;
        logMsg('击败野狼，食物 +2');
      }
    }
  }

  update(dt: number): void {
    if (this.dead) return;

    // 倒地恢复
    if (this.down) {
      this.downT += dt;
      if (this.downT >= CFG.downRecover) {
        this.down = false;
        this.mesh.rotation.x = 0;
        this.hp = Math.max(this.hp, 50);
        if (this.role === 'player') logMsg(this.name + ' 苏醒了');
      }
      return;
    }

    // 饥饿
    if (this.role === 'player') {
      this.hunger = Math.max(0, this.hunger - CFG.hungerRate * dt);
      if (this.hunger <= 0) this.takeDamage(1 * dt);
    }

    // 任务执行
    const t = this.task;
    if (t) {
      if (t.type === 'move') {
        if (!this.moveToward(t.pos!, dt)) this.task = null;
      } else if (t.type === 'gather') {
        if (!this.moveToward(t.pos!, dt)) {
          t.workT += dt;
          this._workAnim(dt);
          if (t.workT >= (t.workDur ?? 2)) this._finishGather(t);
        }
      } else if (t.type === 'attack') {
        const w = t.target as Unit;
        if (!w || w.dead || w.down) {
          this.task = null;
          return;
        }
        if (!this.moveToward(w.pos, dt)) {
          this.lookAtTarget(w.pos);
          this.mesh.rotation.y = this.facing;
          this.atkT -= dt;
          if (this.atkT <= 0) {
            this.atkT = CFG.atkCd;
            this._swing();
            w.takeDamage(CFG.atkDmg);
          }
        }
      } else if (t.type === 'trade') {
        if (!this.moveToward(t.pos!, dt)) {
          t.workT += dt;
          if (t.workT >= 1.2) {
            this.task = null;
            this._onTradeReady();
          }
        }
      }
    }

    // 木屋回血
    if (this.role === 'player') {
      for (const b of buildings) {
        if (b.type === 'house' && this.pos.distanceTo(b.mesh.position) < 6) {
          this.hp = Math.min(100, this.hp + 5 * dt);
          break;
        }
      }
    }
  }

  /** 交易完成回调，由 ui/trade 注入 */
  private _onTradeReady: () => void = () => {};

  setTradeCallback(fn: () => void): void {
    this._onTradeReady = fn;
  }

  private _workAnim(dt: number): void {
    this._torso.rotation.x = Math.sin(this.task!.workT * 9) * 0.3;
    this.mesh.rotation.y = this.facing;
  }

  private _swing(): void {
    this._torso.rotation.x = -0.5;
    setTimeout(() => {
      if (this._torso) this._torso.rotation.x = 0;
    }, 120);
  }

  private _finishGather(t: UnitTask): void {
    this._torso.rotation.x = 0;
    if (t.kind === 'tree') {
      const tree = t.target as TreeEnt;
      bag.wood += CFG.woodPerTree;
      tree.alive = false;
      tree.respawn = 45;
      tree.mesh.visible = false;
      logMsg('砍倒树木，木材 +' + CFG.woodPerTree);
    } else if (t.kind === 'rock') {
      const rock = t.target as RockEnt;
      bag.stone += CFG.stonePerVein;
      rock.hp -= 1;
      logMsg('开采矿石，石头 +' + CFG.stonePerVein);
      if (rock.hp <= 0) {
        rock.alive = false;
        rock.respawn = 90;
        rock.mesh.visible = false;
      }
    } else if (t.kind === 'crop') {
      const tile = t.target as Tile;
      bag.food += CFG.cropPerHarvest;
      tile.state = 0;
      tile.grow = 0;
      tile.mesh.material = tileMats[0];
      tile.ear.visible = false;
      logMsg('收获作物，食物 +' + CFG.cropPerHarvest);
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
