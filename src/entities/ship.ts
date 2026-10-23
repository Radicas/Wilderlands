/**
 * Wilderlands · 主线破船实体（S4，荒诞基调）
 * 一艘倒扣在荒野中央的破船——没人见过海，可它就是搁浅在这儿了。
 * 修好材料后：船翻正 + 穿水手服的狼船长登场（通关）。
 */
import * as THREE from 'three';
import { CFG, PALETTE } from '../config';
import { logMsg } from '../state';
import { groundHeightAt, regInter } from '../core/world';
import { scene } from '../core/renderer';
import { completeShip, ship } from '../systems/ship';

const TILT = Math.PI; // 倒扣（船底朝上）

export interface ShipEnt {
  group: THREE.Group;
  hull: THREE.Mesh;
  mast: THREE.Mesh;
  sail: THREE.Mesh;
  broken: boolean;
  animT: number; // 翻正动画进度 0..1（done 后增长）
  captain: THREE.Group | null;
  captainT: number; // 船长登场动画进度
}

let shipEnt: ShipEnt | null = null;

export function getShipEnt(): ShipEnt | null {
  return shipEnt;
}

function makeMesh(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

export function buildShip(): void {
  const pos = CFG.shipPos;
  const gy = groundHeightAt(pos.x, pos.z);
  const group = new THREE.Group();
  group.position.set(pos.x, gy, pos.z);

  // 船体：倒扣的木船（圆底朝上，舷朝下）
  const hull = makeMesh(
    new THREE.CylinderGeometry(2.6, 1.8, 3.6, 8),
    PALETTE.shipHull,
    0, 0, 0,
  );
  hull.rotation.x = Math.PI / 2; // 横躺成船形
  hull.rotation.z = TILT; // 倒扣：船底朝上
  // 船底壳（更深的色，倒扣朝上那面）
  const keel = makeMesh(
    new THREE.SphereGeometry(2.7, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    PALETTE.shipKeel,
    0, 0, 0,
  );
  keel.rotation.x = Math.PI / 2 + TILT;
  (keel.material as THREE.MeshLambertMaterial).transparent = true;
  (keel.material as THREE.MeshLambertMaterial).opacity = 0.55;

  // 桅杆：从倒扣的船底竖直戳出来（像钉在船上的旗杆）
  const mast = makeMesh(new THREE.CylinderGeometry(0.09, 0.12, 4.2, 6), PALETTE.shipMast, 0, 1.9, 0);
  // 破帆：斜挂的旧布
  const sail = makeMesh(new THREE.PlaneGeometry(1.6, 1.4), PALETTE.shipSailOld, 0.7, 2.6, 0);
  sail.rotation.z = -0.5;

  // 荒诞彩蛋：船首像（一只被倒扣压着的小木狼头）
  const figurehead = makeMesh(new THREE.SphereGeometry(0.28, 6, 5), PALETTE.wolfFur, -1.6, -0.4, 0);

  group.add(hull, keel, mast, sail, figurehead);
  group.rotation.y = 0.6;
  scene.add(group);
  regInter(group, { kind: 'ship' });
  (group as unknown as { userData?: unknown }).userData = { ent: { kind: 'ship' } };

  shipEnt = { group, hull, mast, sail, broken: !ship.done, animT: ship.done ? 1 : 0, captain: null, captainT: 0 };

  // 读档时若已修好：直接翻正 + 船长登场
  if (ship.done) {
    hull.rotation.z = 0;
    sail.material = new THREE.MeshLambertMaterial({ color: PALETTE.shipSail });
    spawnCaptain();
  }
}

/** 修好后：船翻正 + 船长登场（由 ui/ship 在材料集齐时调用） */
export function finishShipVisual(): void {
  if (!shipEnt || !shipEnt.broken) return;
  shipEnt.broken = false;
  completeShip();
  logMsg('咣当！破船翻正了。');
}

function spawnCaptain(): void {
  if (!shipEnt || shipEnt.captain) return;
  const pos = CFG.shipPos;
  const gy = groundHeightAt(pos.x + 2.6, pos.z + 2.2);
  const cap = new THREE.Group();
  cap.position.set(pos.x + 2.6, gy, pos.z + 2.2);

  // 狼身（沿用野狼配色）
  const body = makeMesh(new THREE.BoxGeometry(0.5, 0.42, 1.0), PALETTE.wolfFur, 0, 0.45, 0);
  const head = makeMesh(new THREE.BoxGeometry(0.32, 0.32, 0.4), PALETTE.wolfFur, 0, 0.82, 0.48);
  const eyeL = makeMesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), PALETTE.wolfEye, -0.09, 0.88, 0.68);
  const eyeR = makeMesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), PALETTE.wolfEye, 0.09, 0.88, 0.68);
  const snout = makeMesh(new THREE.BoxGeometry(0.14, 0.1, 0.16), 0x4a3428, 0, 0.78, 0.64);
  // 尾巴
  const tail = makeMesh(new THREE.BoxGeometry(0.1, 0.1, 0.42), PALETTE.wolfFur, 0, 0.62, -0.6);
  tail.rotation.x = -0.5;
  // 水手帽（蓝）
  const hat = makeMesh(new THREE.CylinderGeometry(0.16, 0.19, 0.16, 8), PALETTE.captainHat, 0, 1.02, 0.44);
  const hatBrim = makeMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 8), PALETTE.captainHat, 0, 0.95, 0.44);
  // 红领巾
  const scarf = makeMesh(new THREE.BoxGeometry(0.22, 0.08, 0.1), PALETTE.captainScarf, 0, 0.66, 0.5);

  cap.add(body, head, eyeL, eyeR, snout, tail, hat, hatBrim, scarf);
  cap.rotation.y = 2.2; // 面朝船
  cap.position.y = gy + 0.02;
  scene.add(cap);
  shipEnt.captain = cap;
}

/** 每帧：翻正动画 + 船长登场（cap 高度由地面起伏微调） */
export function updateShip(dt: number): void {
  if (!shipEnt) return;
  const e = shipEnt;
  if (!e.broken && e.animT < 1) {
    e.animT = Math.min(1, e.animT + dt * 0.5);
    e.group.rotation.x = Math.PI * (1 - e.animT);
    e.sail.rotation.z = -0.5 * (1 - e.animT);
    if (e.animT >= 1) {
      e.hull.rotation.z = 0;
      e.sail.material = new THREE.MeshLambertMaterial({ color: PALETTE.shipSail });
      spawnCaptain();
    }
  }
  if (e.captain) {
    // 轻微呼吸浮动
    e.captain.position.y += Math.sin(performance.now() / 600) * 0.003;
  }
}
