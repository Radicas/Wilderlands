/**
 * 装饰动物群（wildlife）：林缘兔子惊跳、鹿群避离、鸟群掠空。
 * 纯表现层红线（同 sound-system D10）：不注册拾取、不进 targets/战斗/存档/sim；
 * 行为走真实时间（realDt），5fps 饥饿帧下依然活动。
 */
import * as THREE from 'three';
import { groundHeightAt } from '../core/world';
import { scene } from '../core/renderer';
import { sfx } from '../core/sound';
import { players, timeOfDay, trees } from '../state';

type Kind = 'rabbit' | 'deer';
interface Critter {
  kind: Kind;
  g: THREE.Group;
  legs: THREE.Object3D[];
  head: THREE.Object3D | null;
  pos: THREE.Vector3;
  yaw: number;
  state: 'idle' | 'hop' | 'graze' | 'lift' | 'step' | 'flee';
  t: number;
  speed: number;
  hopT0: number;
  panic: number; // 惊跳冷却（剩余秒）
}

const critters: Critter[] = [];
let sky: THREE.Group | null = null;
let skyT = -1; // 掠空剩余秒（<0 = 未在飞）
let flyNext = 8 + Math.random() * 20;
let maxHop = 0;
let _v = new THREE.Vector3();

function mat(hex: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: hex });
}

/** 简化四足：躯干胶囊(横) + 四腿细柱 + 头；scale 控体量 */
function quadruped(body: number, fur: number, legH: number, scale: number, antlers = false): { g: THREE.Group; legs: THREE.Object3D[]; head: THREE.Object3D | null } {
  const g = new THREE.Group();
  const furMat = mat(fur);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16 * scale, 0.5 * scale, 4, 6), furMat);
  torso.rotation.z = Math.PI / 2;
  torso.position.y = legH * scale + 0.1 * scale;
  g.add(torso);
  const legs: THREE.Object3D[] = [];
  for (const [lx, lz] of [[-0.12, -0.2], [0.12, -0.2], [-0.12, 0.2], [0.12, 0.2]] as const) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.035 * scale, legH * 0.7 * scale, 3, 5), mat(body));
    leg.position.set(lx * scale, (legH + 0.1 * scale) * scale * 1.0, lz * scale);
    leg.geometry.translate(0, -legH * 0.35 * scale, 0); // 髋部 pivot
    g.add(leg);
    legs.push(leg);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.14 * scale, 0.14 * scale, 0.2 * scale), furMat);
  head.position.set(0, legH * scale + 0.34 * scale, -0.38 * scale);
  if (antlers) {
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * scale, 0.012 * scale, 0.18 * scale, 4), mat(0xd8c8a8));
      a.position.set(s * 0.06 * scale, 0.12 * scale, 0);
      a.rotation.z = s * 0.5;
      head.add(a);
    }
  }
  g.add(head);
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = true; });
  return { g, legs, head };
}

function pickSpot(minTreeDist: number, maxTreeDist: number): THREE.Vector3 {
  const alive = trees.filter((t) => t.alive);
  for (let tries = 0; tries < 40; tries++) {
    const anchor = alive[(Math.random() * alive.length) | 0];
    const a = Math.random() * Math.PI * 2;
    const r = minTreeDist + Math.random() * (maxTreeDist - minTreeDist);
    const x = anchor.p.x + Math.cos(a) * r;
    const z = anchor.p.z + Math.sin(a) * r;
    if (Math.hypot(x, z) > 26) continue; // 别跑出世界边缘
    return new THREE.Vector3(x, groundHeightAt(x, z), z);
  }
  const t = alive[0];
  return new THREE.Vector3(t.p.x + 3, groundHeightAt(t.p.x + 3, t.p.z), t.p.z + 3);
}

export function initWildlife(): void {
  for (let i = 0; i < 6; i++) {
    const q = quadruped(0x8a8578, 0xcfc8bc, 0.16, 0.75);
    const p = pickSpot(2, 4);
    q.g.position.copy(p);
    scene.add(q.g);
    critters.push({ kind: 'rabbit', g: q.g, legs: q.legs, head: q.head, pos: p.clone(), yaw: Math.random() * 6.28, state: 'idle', t: Math.random() * 2, speed: 1.1, hopT0: 0, panic: 0 });
  }
  const herd = pickSpot(5, 8);
  for (let i = 0; i < 4; i++) {
    const q = quadruped(0x6a4a30, 0x9a7450, 0.55, 1.35, i % 2 === 0);
    const off = i === 0 ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8);
    const p = new THREE.Vector3(herd.x + off.x, 0, herd.z + off.z);
    p.y = groundHeightAt(p.x, p.z);
    q.g.position.copy(p);
    scene.add(q.g);
    critters.push({ kind: 'deer', g: q.g, legs: q.legs, head: q.head, pos: p.clone(), yaw: Math.random() * 6.28, state: 'graze', t: Math.random() * 3, speed: 1.6, hopT0: 0, panic: 0 });
  }
  sky = new THREE.Group();
  const birdMat = mat(0x2a2a30);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.3), birdMat);
    b.position.set((i % 2 ? -1 : 1) * 0.5 * i, 0, -0.6 * i); // V 字阵
    sky.add(b);
  }
  sky.visible = false;
  scene.add(sky);
}

function faceTo(c: Critter, x: number, z: number): void {
  c.yaw = Math.atan2(x - c.pos.x, z - c.pos.z);
  c.g.rotation.y = c.yaw;
}

function move(c: Critter, dt: number, sp: number): void {
  _v.set(Math.sin(c.yaw), 0, Math.cos(c.yaw)).multiplyScalar(sp * dt);
  c.pos.add(_v);
  if (Math.hypot(c.pos.x, c.pos.z) > 28) { c.yaw += Math.PI; c.g.rotation.y = c.yaw; } // 边界折返
  c.pos.y = groundHeightAt(c.pos.x, c.pos.z);
}

function swingLegs(c: Critter, phase: number, amp: number): void {
  c.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * amp; });
}

let lastRealAt = 0;
export function wildlifeTick(reduced: boolean): void {
  if (reduced) return; // W5：静止保位
  // 真实时间自差分（同 sound D6）：主循环 dt 被 min(0.05) 钳制，低帧率下排程会假死
  const now = performance.now();
  const realDt = lastRealAt ? Math.min((now - lastRealAt) / 1000, 1) : 0;
  lastRealAt = now;
  maxHop *= Math.max(0, 1 - realDt / 10); // 10s 半衰窗：静置基线可对比
  const u = players[0];
  const night = timeOfDay.isNight;
  flyNext -= realDt;
  if (!night && flyNext <= 0 && skyT < 0) {
    if (sky) {
      const a0 = Math.random() * Math.PI * 2;
      sky.position.set(Math.cos(a0) * 34, 10.5, Math.sin(a0) * 34); // 边缘进入
      sky.rotation.y = a0 + Math.PI;
      sky.visible = true;
      skyT = 14;
      sfx('bird'); // 啁啾与掠空同拍（静音时只掠空不出声，正常降级）
    }
    flyNext = 25 + Math.random() * 35;
  }
  if (skyT >= 0 && sky) {
    skyT -= realDt;
    const sp = 4.8;
    sky.position.x += Math.sin(sky.rotation.y) * sp * realDt;
    sky.position.z += Math.cos(sky.rotation.y) * sp * realDt;
    sky.position.y = 10.5 + Math.sin(performance.now() / 400) * 0.3;
    if (skyT < 0) sky.visible = false;
  }
  if (night) { // 夜间兔鹿归静止（flee 亦停：狼出没时段不抢戏）
    for (const c of critters) { c.state = c.kind === 'rabbit' ? 'idle' : 'graze'; c.t = 0; }
    return;
  }

  for (const c of critters) {
    c.t += realDt;
    c.panic = Math.max(0, c.panic - realDt);
    const pd = u ? Math.hypot(c.pos.x - u.pos.x, c.pos.z - u.pos.z) : 999;
    if (c.kind === 'rabbit') {
      if (pd < 6 && c.panic <= 0) { // 惊跳：窜离 + 冷却
        faceTo(c, c.pos.x + (c.pos.x - u.pos.x), c.pos.z + (c.pos.z - u.pos.z));
        c.state = 'hop'; c.t = 0; c.hopT0 = 0; c.panic = 4; c.speed = 3.2;
      }
      if (c.state === 'idle' && c.t > 2.5 + Math.random() * 2) { c.state = 'hop'; c.t = 0; c.hopT0 = 0; c.yaw += (Math.random() - 0.5) * 2; c.g.rotation.y = c.yaw; }
      if (c.state === 'hop') {
        const dur = 0.4;
        const amp = 0.28 * (c.panic > 0 ? 2 : 1);
        const h = Math.sin(Math.min(1, c.t / dur) * Math.PI) * amp;
        c.g.position.copy(c.pos); c.g.position.y += h;
        maxHop = Math.max(maxHop, amp); // 记录本次 hop 的档位（帧抽样会漏掉抛物线顶，档位法与 fps 解耦）
        move(c, realDt, c.speed);
        swingLegs(c, c.t * 20, 0.7);
        if (c.t >= dur) { c.state = 'idle'; c.t = 0; c.speed = 1.1; c.g.position.copy(c.pos); }
      } else {
        c.g.position.copy(c.pos);
        if (c.t > 8) { c.state = 'hop'; c.t = 0; }
      }
    } else {
      const fleeing = c.state === 'flee' || pd < 9;
      if (fleeing) {
        if (c.state !== 'flee') { c.state = 'flee'; c.t = 0; }
        faceTo(c, c.pos.x + (c.pos.x - u.pos.x), c.pos.z + (c.pos.z - u.pos.z));
        const ramp = Math.min(2.4, 1.2 + c.t * 0.5); // 渐速不狂奔（低于玩家 4）
        move(c, realDt, ramp);
        swingLegs(c, c.t * 9, 0.55);
        c.g.position.copy(c.pos);
        if (pd > 16 && c.t > 4) { c.state = 'graze'; c.t = 0; }
      } else if (c.state === 'graze') {
        c.g.position.copy(c.pos);
        if (c.head) c.head.rotation.x = 0.9 * Math.min(1, c.t); // 低头
        if (c.t > 3) { c.state = 'lift'; c.t = 0; }
      } else if (c.state === 'lift') {
        if (c.head) c.head.rotation.x = 0;
        if (c.t > 2) { c.state = 'step'; c.t = 0; c.yaw += (Math.random() - 0.5) * 1.4; c.g.rotation.y = c.yaw; }
        c.g.position.copy(c.pos);
      } else {
        move(c, realDt, 0.7);
        swingLegs(c, c.t * 6, 0.35);
        c.g.position.copy(c.pos);
        if (c.t > 1) { c.state = 'graze'; c.t = 0; }
      }
    }
  }
}

export function wildlifeStats(reset = false): { rabbits: number; deer: number; birds: number; skyActive: boolean; maxHop: number; nearestDeer: { d: number; fleeing: boolean } | null; nearestRabbit: { d: number } | null; deerPos: { x: number; z: number } | null; rabbitPos: { x: number; z: number } | null } {
  const u = players[0];
  let nd: { d: number; fleeing: boolean } | null = null;
  let nrb: { d: number } | null = null;
  let dp: { x: number; z: number } | null = null;
  let rp: { x: number; z: number } | null = null;
  let nr = 0;
  for (const c of critters) {
    if (c.kind === 'deer') {
      const d = u ? Math.hypot(c.pos.x - u.pos.x, c.pos.z - u.pos.z) : -1;
      if (!nd || d < nd.d) { nd = { d, fleeing: c.state === 'flee' }; dp = { x: +c.pos.x.toFixed(2), z: +c.pos.z.toFixed(2) }; }
    }
    if (c.kind === 'rabbit') {
      nr++;
      const d = u ? Math.hypot(c.pos.x - u.pos.x, c.pos.z - u.pos.z) : -1;
      if (!nrb || d < nrb.d) { nrb = { d }; rp = { x: +c.pos.x.toFixed(2), z: +c.pos.z.toFixed(2) }; }
    }
  }
  if (reset) maxHop = 0;
  return { rabbits: nr, deer: critters.length - nr, birds: sky && sky.visible ? 5 : 0, skyActive: skyT >= 0, maxHop, nearestDeer: nd, nearestRabbit: nrb, deerPos: dp, rabbitPos: rp };
}
