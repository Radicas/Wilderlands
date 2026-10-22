/**
 * Wilderlands · 世界生成
 * 地块网格（家园/野地/矿区三区）、地面网格线、松树、岩脉、贸易站。
 */
import * as THREE from 'three';
import { PALETTE, WORLD } from '../config';
import type { RockEnt, Tile, TreeEnt } from '../types';
import { interMeshes, merchantPos, rocks, shop, tiles, trees } from '../state';
import { scene } from './renderer';

export const TILE = WORLD.tileSize;
export const GRID = WORLD.grid;
const HALF = GRID / 2;

// ---- 地块 ----
export const tileMats: Record<number, THREE.MeshLambertMaterial> = {
  0: new THREE.MeshLambertMaterial({ color: PALETTE.tileHome }),
  1: new THREE.MeshLambertMaterial({ color: PALETTE.tilePlanted }),
  2: new THREE.MeshLambertMaterial({ color: PALETTE.tileGrowing }),
  3: new THREE.MeshLambertMaterial({ color: PALETTE.tileMature }),
};

export function buildGround(): void {
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const gx = x - HALF;
      const gz = z - HALF;
      const dist = Math.hypot(gx, gz);
      // 地形分区：内圈家园草绿，中圈野地黄褐，外圈矿区蓝灰
      let col: number = PALETTE.tileHome;
      if (dist > WORLD.homeRadius) col = PALETTE.tileWild;
      if (dist > WORLD.wildRadius) col = PALETTE.tileMine;

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(TILE - 0.06, 0.18, TILE - 0.06),
        new THREE.MeshLambertMaterial({ color: col }),
      );
      mesh.position.set(gx * TILE, -0.09, gz * TILE);
      mesh.rotation.y = (x + z) % 2 ? 0 : Math.PI / 4;
      scene.add(mesh);

      // 麦穗标记（成熟时显示）
      const ear = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.16, 0.55, 5),
        new THREE.MeshLambertMaterial({ color: PALETTE.ear }),
      );
      ear.position.y = 0.3;
      ear.visible = false;
      mesh.add(ear);

      tiles.push({
        x: gx,
        z: gz,
        state: 0,
        grow: 0,
        isHome: dist <= WORLD.homeRadius,
        mesh,
        ear,
      });
    }
  }

  // 地面网格线（空间感）
  const grid = new THREE.GridHelper(
    GRID * TILE,
    GRID,
    PALETTE.gridCenter,
    PALETTE.gridLine,
  );
  grid.position.y = 0.03;
  scene.add(grid);
}

/** 由世界坐标查地块 */
export function tileAt(x: number, z: number): Tile | undefined {
  return tiles.find(
    (t) => t.x === Math.round(x / TILE) && t.z === Math.round(z / TILE),
  );
}

// ---- 松树 ----
const treeGeo = new THREE.ConeGeometry(0.6, 2.0, 6);
const treeMat = new THREE.MeshLambertMaterial({ color: PALETTE.treeCrown });
const trunkMat = new THREE.MeshLambertMaterial({ color: PALETTE.treeTrunk });

export function buildTrees(): void {
  for (let i = 0; i < WORLD.treeCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 6.5 + Math.random() * 6.5;
    const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const t = tileAt(p.x, p.z);
    if (t && t.isHome) continue;

    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.8, 5), trunkMat);
    trunk.position.y = 0.4;
    const crown = new THREE.Mesh(treeGeo, treeMat.clone());
    crown.position.y = 1.7;
    crown.rotation.y = Math.random() * 3;
    g.add(trunk, crown);
    g.position.copy(p);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    scene.add(g);

    const ent: TreeEnt = { p, mesh: g, alive: true, respawn: 0 };
    trees.push(ent);
    regInter(g, { kind: 'tree', ent });
  }
}

// ---- 岩脉 ----
const rockMat = new THREE.MeshLambertMaterial({ color: PALETTE.rock });

export function buildRocks(): void {
  for (let i = 0; i < WORLD.rockCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8.5 + Math.random() * 6;
    const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const t = tileAt(p.x, p.z);
    if (t && t.isHome) continue;

    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), rockMat.clone());
    mesh.position.copy(p);
    mesh.position.y = 0.35;
    mesh.rotation.set(Math.random() * 2, Math.random() * 3, Math.random() * 2);
    mesh.scale.set(1, 0.6 + Math.random() * 0.5, 1);
    mesh.castShadow = true;
    scene.add(mesh);

    const ent: RockEnt = { p, mesh, hp: 3, alive: true, respawn: 0 };
    rocks.push(ent);
    regInter(mesh, { kind: 'rock', ent });
  }
}

// ---- 贸易站 ----
export function buildMerchant(): void {
  const stall = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 1.6, 1.2),
    new THREE.MeshLambertMaterial({ color: PALETTE.merchantStall }),
  );
  stall.position.y = 0.8;

  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.14, 1.7),
    new THREE.MeshLambertMaterial({ color: PALETTE.merchantCanopy }),
  );
  canopy.position.set(0, 1.8, 0);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.5, 0.08),
    new THREE.MeshLambertMaterial({ color: PALETTE.merchantSign }),
  );
  sign.position.set(0, 2.4, 0.5);

  const goldBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 10),
    new THREE.MeshLambertMaterial({ color: PALETTE.goldBall, emissive: 0x7a5a10 }),
  );
  goldBall.position.set(0, 2.9, 0.5);

  shop.add(stall, canopy, sign, goldBall);
  shop.position.copy(merchantPos);
  shop.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  scene.add(shop);

  const shopLight = new THREE.PointLight(0xffd08a, 1.3, 9);
  shopLight.position.set(merchantPos.x, 2.2, merchantPos.z);
  scene.add(shopLight);

  regInter(shop, { kind: 'merchant' });
}

/** 注册可交互实体（射线命令目标） */
export function regInter(group: THREE.Object3D, ent: unknown): void {
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.userData.ent = ent;
      interMeshes.push(o);
    }
  });
}
