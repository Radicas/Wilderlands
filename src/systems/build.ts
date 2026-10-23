/**
 * Wilderlands · 建造系统
 * 围栏（边界）与木屋（休息回血）。
 */
import * as THREE from 'three';
import { CFG, PALETTE } from '../config';
import type { Unit } from '../types';
import { buildings, logMsg } from '../state';
import { invRemove } from './inventory';
import { scene } from '../core/renderer';
import { regInter, groundHeightAt } from '../core/world';

export function nearBuilding(p: THREE.Vector3): boolean {
  return buildings.some((b) => b.mesh.position.distanceTo(p) < 1.6);
}

export function buildFence(p: THREE.Vector3, from: Unit): boolean {
  if (!invRemove(from, 'wood', CFG.fenceCost)) {
    logMsg('木材不足（围栏需 2）');
    return false;
  }
  placeFenceAt(p);
  logMsg('建造围栏，木材 -' + CFG.fenceCost);
  return true;
}

/** 纯放置围栏（读档恢复用，不扣资源） */
export function placeFenceAt(p: THREE.Vector3): void {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.fence });
  const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), mat);
  p1.position.set(-0.55, 0.55, 0);
  const p2 = p1.clone();
  p2.position.x = 0.55;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.1), mat);
  rail.position.y = 0.85;
  g.add(p1, p2, rail);
  g.position.set(p.x, groundHeightAt(p.x, p.z), p.z);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  scene.add(g);
  regInter(g, { kind: 'fence' });
  buildings.push({ type: 'fence', mesh: g });
}

export function buildHouse(p: THREE.Vector3, from: Unit): boolean {
  if (!invRemove(from, 'wood', CFG.houseCostWood)) {
    logMsg('木屋需要木材 10 + 石头 5');
    return false;
  }
  if (!invRemove(from, 'stone', CFG.houseCostStone)) {
    // 回滚已扣的木材
    from.inv.wood = (from.inv.wood ?? 0) + CFG.houseCostWood;
    logMsg('木屋需要木材 10 + 石头 5');
    return false;
  }
  placeHouseAt(p);
  logMsg('木屋建成，附近拓荒者缓慢回血');
  return true;
}

/** 纯放置木屋（读档恢复用，不扣资源） */
export function placeHouseAt(p: THREE.Vector3): void {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshLambertMaterial({ color: PALETTE.houseWall });
  const roofMat = new THREE.MeshLambertMaterial({ color: PALETTE.houseRoof });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.5, 2.6), wallMat);
  wall.position.y = 0.75;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.1, 4), roofMat);
  roof.position.y = 2.05;
  roof.rotation.y = Math.PI / 4;
  g.add(wall, roof);
  g.position.set(p.x, groundHeightAt(p.x, p.z), p.z);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  scene.add(g);
  regInter(g, { kind: 'house' });
  buildings.push({ type: 'house', mesh: g });
}
