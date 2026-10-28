/**
 * Wilderlands · 世界生成
 * 地块网格（家园/野地/矿区三区）、地面网格线、松树、岩脉、贸易站。
 * 纯地形函数（噪声/地面高度）单一权威在 ../sim/terrain.ts，这里 re-export。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG, PALETTE, SCENE, TREES, TREE_STAGE_SCALE, WORLD, WANDERER_NAMES } from '../config';
import type { BerryEnt, RockEnt, Tile, TreeEnt, TreeMats, WandererEnt } from '../types';
import { berries, interMeshes, merchantPos, rocks, setWanderer, shop, tiles, trees } from '../state';
import { scene, shakeCamera } from './renderer';
import { sfx } from './sound';
import { TILE, GRID, noise2D, groundHeightAt } from '../sim/terrain';

export { TILE, GRID, noise2D, groundHeightAt };
const HALF = GRID / 2;

// ---- 地块 ----
export const tileMats: Record<number, THREE.MeshLambertMaterial> = {
  0: new THREE.MeshLambertMaterial({ color: PALETTE.tileHome }),
  1: new THREE.MeshLambertMaterial({ color: PALETTE.tilePlanted }),
  2: new THREE.MeshLambertMaterial({ color: PALETTE.tileGrowing }),
  3: new THREE.MeshLambertMaterial({ color: PALETTE.tileMature }),
};

export function buildGround(): void {
  // ---- 连续地面大平面（消除缝隙） ----
  const worldSize = GRID * TILE;
  const segments = 64; // 细分足够多，起伏平滑
  const groundGeo = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
  groundGeo.rotateX(-Math.PI / 2);

  // 按噪声设置每个顶点的 Y 高度，并按距离分区上色
  const posAttr = groundGeo.attributes.position;
  const colors: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const gy = groundHeightAt(vx, vz);
    posAttr.setY(i, gy);

    // 按距离分区上色（家园/野地/矿区）
    const dist = Math.hypot(vx / TILE, vz / TILE);
    if (dist > WORLD.wildRadius) color.setHex(PALETTE.tileMine);
    else if (dist > WORLD.homeRadius) color.setHex(PALETTE.tileWild);
    else color.setHex(PALETTE.tileHome);

    // 加一点随机色差，避免纯色单调
    const jitter = (Math.random() - 0.5) * 0.04;
    colors.push(color.r + jitter, color.g + jitter, color.b + jitter);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();

  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ---- 农田地块（叠加层，只在非荒地时显示） ----
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const gx = x - HALF;
      const gz = z - HALF;
      const dist = Math.hypot(gx, gz);
      const isHome = dist <= WORLD.homeRadius;

      const worldX = gx * TILE;
      const worldZ = gz * TILE;
      const groundY = groundHeightAt(worldX, worldZ);

      // 农田地块：薄平面叠加在连续地面上
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE - 0.1, TILE - 0.1),
        tileMats[0].clone(),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(worldX, groundY + 0.02, worldZ);
      mesh.visible = false; // 荒地时隐藏，播种后显示
      mesh.receiveShadow = true;

      // 麦穗标记（成熟时显示）
      const ear = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.16, 0.55, 5),
        new THREE.MeshLambertMaterial({ color: PALETTE.ear }),
      );
      ear.position.y = 0.35;
      ear.visible = false;
      mesh.add(ear);

      tiles.push({
        x: gx,
        z: gz,
        state: 0,
        grow: 0,
        isHome,
        mesh,
        ear,
      });
    }
  }
}

/** 由世界坐标查地块 */
export function tileAt(x: number, z: number): Tile | undefined {
  return tiles.find(
    (t) => t.x === Math.round(x / TILE) && t.z === Math.round(z / TILE),
  );
}

// ---- 森林（多树种 InstancedMesh：每树种干/冠各 1 批，共 6 draw call，forest-life）----
interface SpeciesVisual {
  trunkGeo: THREE.BufferGeometry; trunkMat: THREE.MeshLambertMaterial; trunkH: number;
  crownGeo: THREE.BufferGeometry; crownMat: THREE.MeshLambertMaterial;
  /** 成树冠中心离地高（阶段缩放锚定树根：y = 原偏移 × scale） */
  crownY: number;
}

const oakCrownGeo = mergeGeometries([
  new THREE.SphereGeometry(1.0, 8, 6).translate(-0.45, 0.3, 0),
  new THREE.SphereGeometry(0.78, 8, 6).translate(0.5, 0.55, 0.1),
]) as THREE.BufferGeometry;

const SPECIES_VISUALS: SpeciesVisual[] = [
  { // 0 松树：现几何原样（回归锚）
    trunkGeo: new THREE.CylinderGeometry(SCENE.treeTrunkRt, SCENE.treeTrunkRb, SCENE.treeTrunkH, 5),
    trunkMat: new THREE.MeshLambertMaterial({ color: PALETTE.treeTrunk }), trunkH: SCENE.treeTrunkH,
    crownGeo: new THREE.ConeGeometry(SCENE.treeCrownR, SCENE.treeCrownH, 6),
    crownMat: new THREE.MeshLambertMaterial({ color: PALETTE.treeCrown }),
    crownY: SCENE.treeTrunkH + SCENE.treeCrownH / 2 - 0.1,
  },
  { // 1 橡树：粗短干 + 双球叠冠
    trunkGeo: new THREE.CylinderGeometry(0.3, 0.42, 1.0, 6),
    trunkMat: new THREE.MeshLambertMaterial({ color: PALETTE.oakTrunk }), trunkH: 1.0,
    crownGeo: oakCrownGeo,
    crownMat: new THREE.MeshLambertMaterial({ color: PALETTE.oakCrown }),
    crownY: 2.0,
  },
  { // 2 白桦：细高白干 + 小球冠
    trunkGeo: new THREE.CylinderGeometry(0.1, 0.16, 2.5, 5),
    trunkMat: new THREE.MeshLambertMaterial({ color: PALETTE.birchTrunk }), trunkH: 2.5,
    crownGeo: new THREE.SphereGeometry(0.78, 7, 5),
    crownMat: new THREE.MeshLambertMaterial({ color: PALETTE.birchCrown }),
    crownY: 3.1,
  },
];

interface TreeRig { trunkIM: THREE.InstancedMesh; crownIM: THREE.InstancedMesh }
const treeRigs: TreeRig[] = [];
/** 全局 trees[] 下标 ↔ 树种内 slot 双向：ent.slot 存于 TreeEnt，反查由 bySpecies 闭包 */
const bySpecies: TreeEnt[][] = [[], [], []];

const _dummy = new THREE.Object3D();

/** 写回当前阶段矩阵（换阶/显隐统一入口） */
function writeTreeMat(tree: TreeEnt): void {
  if (tree.phase === 'stump') return;
  const rig = treeRigs[tree.species];
  const m = tree.mats[tree.phase];
  rig.trunkIM.setMatrixAt(tree.slot, m.trunk);
  rig.crownIM.setMatrixAt(tree.slot, m.crown);
  rig.trunkIM.instanceMatrix.needsUpdate = true;
  rig.crownIM.instanceMatrix.needsUpdate = true;
}

/** 外部（生长阶段机）用：按当前 phase 恢复/更新实例矩阵 */
export function applyTreePhase(tree: TreeEnt): void { writeTreeMat(tree); }

/** 根据全局树号显隐一棵树（visible=false 进入消亡补间；true 写回当前阶段矩阵） */
function applyTreeVisible(id: number, v: boolean): void {
  const tree = trees[id];
  if (!tree) return;
  const di = dyingTrees.findIndex((d) => d.tree === tree);
  if (v) {
    if (di >= 0) dyingTrees.splice(di, 1); // 新苗打断补间
    if (tree.phase !== 'stump') writeTreeMat(tree);
  } else if (di < 0 && tree.phase !== 'stump') {
    // 进入 0.4s 下沉缩小补间（从当前阶段矩阵起步——砍小树也正确下沉）
    const m = tree.mats[tree.phase];
    dyingTrees.push({
      tree, t: 0,
      dur: TREES[tree.species].fallDur, // 树种重量快照（tree-fall D2）
      yaw: tree.fallYaw ?? Math.random() * Math.PI * 2,
      trunkM: m.trunk.clone(), crownM: m.crown.clone(),
    });
    sfx('thud'); // 倒木沙沙（sound-system，起倒时刻）
  }
}

/** —— 消亡补间（gather-feedback F3，forest-life rig 化）：砍倒/采空 → 0.4 秒下沉缩小 —— */
const DEATH_DUR = 0.4;

interface DeadTransform { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
interface DyingTree { tree: TreeEnt; t: number; dur: number; yaw: number; trunkM: THREE.Matrix4; crownM: THREE.Matrix4 }
interface DyingRock { id: number; t: number; tr: DeadTransform }

const dyingTrees: DyingTree[] = [];
const dyingRocks: DyingRock[] = [];
/* 倾覆矩阵链暂存（tree-fall D1，模块级复用零 GC） */
const _FA_P = new THREE.Matrix4();
const _FA_N = new THREE.Matrix4();
const _FA_R = new THREE.Matrix4();
const _FA_X = new THREE.Matrix4();
const _FA_S = new THREE.Matrix4();
const _FA_M = new THREE.Matrix4();
const _FA_O = new THREE.Matrix4();
const _dp = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _ds = new THREE.Vector3();

/** 实例矩阵落地下深处终态（scale=0 在某些驱动下有法线问题，沿用位移方案） */
function setInstanceUnder(im: THREE.InstancedMesh, id: number): void {
  _dummy.position.set(0, -100, 0);
  _dummy.scale.set(0, 0, 0);
  _dummy.rotation.set(0, 0, 0);
  _dummy.updateMatrix();
  im.setMatrixAt(id, _dummy.matrix);
}

function readTransform(m: THREE.Matrix4): DeadTransform {
  const tr = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  m.decompose(tr.p, tr.q, tr.s);
  return tr;
}

/** 每帧由 stepGame 调用：推进补间，完成后落入地下终态 */
export function tickDeathAnims(dt: number): void {
  if (treeRigs.length) {
    let dirty = false;
    for (let i = dyingTrees.length - 1; i >= 0; i--) {
      const d = dyingTrees[i];
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      const e = 1 - (1 - k) * (1 - k); // easeOutQuad：起倒快落地沉
      const theta = e * (Math.PI / 2 - 0.06);
      const sh = k > 0.85 ? 1 - ((k - 0.85) / 0.15) * 0.18 : 1; // 尾段微收出画，规避躺平穿地
      const rig = treeRigs[d.tree.species];
      const p = d.tree.p;
      _FA_P.makeTranslation(p.x, p.y, p.z);
      _FA_N.makeTranslation(-p.x, -p.y, -p.z);
      _FA_R.makeRotationY(d.yaw);
      _FA_X.makeRotationX(theta);
      _FA_R.multiply(_FA_X); // 局部前倾（+Z 倒向 = yaw 方位，D3 几何）
      _FA_M.copy(_FA_P).multiply(_FA_R).multiply(_FA_N);
      if (sh < 1) { _FA_S.makeScale(sh, sh, sh); _FA_M.copy(_FA_P).multiply(_FA_S).multiply(_FA_N).multiply(_FA_M); }
      _FA_O.copy(_FA_M).multiply(d.trunkM); rig.trunkIM.setMatrixAt(d.tree.slot, _FA_O);
      _FA_O.copy(_FA_M).multiply(d.crownM); rig.crownIM.setMatrixAt(d.tree.slot, _FA_O);
      if (k >= 1) {
        setInstanceUnder(rig.trunkIM, d.tree.slot); setInstanceUnder(rig.crownIM, d.tree.slot); // 终态与空窗语义不变（spec 场景三）
        dyingTrees.splice(i, 1);
        shakeCamera(0.016 + 0.05 * d.dur); // 砸地镜头微震，按重量分档（tree-fall D4）
        sfx('down');
      }
      dirty = true;
    }
    if (dirty) for (const rig of treeRigs) { rig.trunkIM.instanceMatrix.needsUpdate = true; rig.crownIM.instanceMatrix.needsUpdate = true; }
  }
  if (rockIM) {
    let dirty = false;
    for (let i = dyingRocks.length - 1; i >= 0; i--) {
      const d = dyingRocks[i];
      d.t += dt;
      const k = Math.max(0, 1 - d.t / DEATH_DUR);
      _dp.copy(d.tr.p); _dp.y -= (1 - k) * 0.3;
      _ds.copy(d.tr.s).multiplyScalar(k);
      _dummy.position.copy(_dp); _dummy.quaternion.copy(d.tr.q); _dummy.scale.copy(_ds);
      _dummy.updateMatrix();
      rockIM.setMatrixAt(d.id, _dummy.matrix);
      if (d.t >= DEATH_DUR) {
        setInstanceUnder(rockIM, d.id);
        dyingRocks.splice(i, 1);
      }
      dirty = true;
    }
    if (dirty) rockIM.instanceMatrix.needsUpdate = true;
  }
}

/** 进行中消亡计数（主循环廉价探测，tree-fall 夹具用） */
export function dyingCount(): number { return dyingTrees.length; }

/** 进行中消亡样本只读快照（G25 断言用；逐字段拷贝不泄漏内部对象） */
export function dyingSnapshot(): { species: number; t: number; dur: number; yaw: number }[] {
  return dyingTrees.map((d) => ({ species: d.tree.species, t: d.t, dur: d.dur, yaw: d.yaw }));
}

/** 给一个逻辑锚点 Object3D 覆写 visible setter，让外部 `ent.mesh.visible = false` 仍可用 */
function bindVisible(anchor: THREE.Object3D, id: number, apply: (id: number, v: boolean) => void): void {
  let _vis = true;
  Object.defineProperty(anchor, 'visible', {
    get: () => _vis,
    set: (v: boolean) => {
      _vis = v;
      apply(id, v);
    },
  });
}

export function buildTrees(): void {
  // 1) 拒绝采样定植点：数量上限 treeCount、两树平面间距 ≥ treeMinGap（≤4×尝试后弃额）
  const accepted: { p: THREE.Vector3; species: number }[] = [];
  const SPECIES_MAP = [0, 0, 1, 2]; // i%4 → 松50/橡25/桦25（确定性，零额外随机流）
  let tries = 0;
  while (accepted.length < WORLD.treeCount && tries++ < WORLD.treeCount * 4) {
    const a = Math.random() * Math.PI * 2;
    const r = WORLD.homeRadius * TILE * 0.8 + Math.random() * (WORLD.grid * TILE * 0.45);
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const t = tileAt(px, pz);
    if (t && t.isHome) continue;
    if (accepted.some((s) => Math.hypot(s.p.x - px, s.p.z - pz) < WORLD.treeMinGap)) continue;
    accepted.push({ p: new THREE.Vector3(px, groundHeightAt(px, pz), pz), species: SPECIES_MAP[accepted.length % 4] });
  }

  // 2) 每树种一套 IM 对 + 全局 trees[] 与 bySpecies[slot] 双向挂接
  const counts = [0, 0, 0];
  accepted.forEach((s) => counts[s.species]++);
  SPECIES_VISUALS.forEach((v, s) => {
    const trunkIM = new THREE.InstancedMesh(v.trunkGeo, v.trunkMat, counts[s]);
    const crownIM = new THREE.InstancedMesh(v.crownGeo, v.crownMat, counts[s]);
    trunkIM.castShadow = true;
    crownIM.castShadow = true;
    treeRigs[s] = { trunkIM, crownIM };
    bySpecies[s] = [];
    // instanceId（树种内 slot）→ 树实体反查
    crownIM.userData.resolveInstance = (id: number) => ({ kind: 'tree', ent: bySpecies[s][id] });
    trunkIM.userData.resolveInstance = (id: number) => ({ kind: 'tree', ent: bySpecies[s][id] });
    interMeshes.push(trunkIM, crownIM);
  });

  accepted.forEach((sp) => {
    const v = SPECIES_VISUALS[sp.species];
    const p = sp.p;
    const ry = Math.random() * Math.PI * 2; // 冠向随机（视觉抖动，非生态随机流）

    // 阶段矩阵预计算：锚定树根等比缩放（D6），换阶 O(1) 拷贝
    const mats = {} as TreeMats;
    const keys = ['sprout', 'young', 'mature'] as const;
    keys.forEach((k, ki) => {
      const s = TREE_STAGE_SCALE[ki];
      _dummy.position.set(p.x, p.y + (v.trunkH * s) / 2, p.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      const trunk = _dummy.matrix.clone();
      _dummy.position.set(p.x, p.y + v.crownY * s, p.z);
      _dummy.rotation.set(0, ry, 0);
      _dummy.updateMatrix();
      mats[k] = { trunk, crown: _dummy.matrix.clone() };
    });

    const rig = treeRigs[sp.species];
    const slot = bySpecies[sp.species].length;
    rig.trunkIM.setMatrixAt(slot, mats.mature.trunk);
    rig.crownIM.setMatrixAt(slot, mats.mature.crown);

    const anchor = new THREE.Object3D();
    anchor.position.copy(p);
    bindVisible(anchor, trees.length, applyTreeVisible);

    const tree: TreeEnt = { p, mesh: anchor, alive: true, respawn: 0, species: sp.species, slot, phase: 'mature', mats };
    bySpecies[sp.species].push(tree);
    trees.push(tree);
  });

  for (const rig of treeRigs) {
    rig.trunkIM.instanceMatrix.needsUpdate = true;
    rig.crownIM.instanceMatrix.needsUpdate = true;
    scene.add(rig.trunkIM, rig.crownIM);
  }
}

// ---- 岩脉（InstancedMesh：90 块石头共用 1 个 draw call）----
const rockGeo = new THREE.DodecahedronGeometry(SCENE.rockR, 0);
const rockMat = new THREE.MeshLambertMaterial({ color: PALETTE.rock });

let rockIM: THREE.InstancedMesh;
const rockOriginals: THREE.Matrix4[] = [];

function applyRockVisible(id: number, v: boolean): void {
  const orig = rockOriginals[id];
  if (!orig) return;
  const di = dyingRocks.findIndex((d) => d.id === id);
  if (v) {
    if (di >= 0) dyingRocks.splice(di, 1);
    rockIM.setMatrixAt(id, orig);
    rockIM.instanceMatrix.needsUpdate = true;
  } else if (di < 0) {
    dyingRocks.push({ id, t: 0, tr: readTransform(orig) });
  }
}

export function buildRocks(): void {
  const spots: { p: THREE.Vector3; rot: THREE.Euler; sc: number }[] = [];
  for (let i = 0; i < WORLD.rockCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = WORLD.wildRadius * TILE * 0.7 + Math.random() * (WORLD.grid * TILE * 0.35);
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const t = tileAt(px, pz);
    if (t && t.isHome) continue;
    spots.push({
      p: new THREE.Vector3(px, groundHeightAt(px, pz), pz),
      rot: new THREE.Euler(Math.random() * 2, Math.random() * 3, Math.random() * 2),
      sc: 0.6 + Math.random() * 0.5,
    });
  }

  const n = spots.length;
  rockIM = new THREE.InstancedMesh(rockGeo, rockMat, n);
  rockIM.castShadow = true;

  spots.forEach((s, i) => {
    _dummy.position.set(s.p.x, s.p.y + SCENE.rockR / 2, s.p.z);
    _dummy.rotation.copy(s.rot);
    _dummy.scale.set(1, s.sc, 1);
    _dummy.updateMatrix();
    rockIM.setMatrixAt(i, _dummy.matrix);
    rockOriginals.push(_dummy.matrix.clone());

    const anchor = new THREE.Object3D();
    anchor.position.copy(s.p);
    bindVisible(anchor, i, applyRockVisible);

    rocks.push({ p: s.p, mesh: anchor, hp: 3, alive: true, respawn: 0 });
  });

  rockIM.instanceMatrix.needsUpdate = true;
  scene.add(rockIM);

  rockIM.userData.resolveInstance = (id: number) => ({ kind: 'rock', ent: rocks[id] });
  interMeshes.push(rockIM);
}

// ---- 浆果丛 ----
const berryLeafMat = new THREE.MeshLambertMaterial({ color: PALETTE.berryLeaf });
const berryRedMat = new THREE.MeshLambertMaterial({ color: PALETTE.berryRed, emissive: 0x3a1010 });

/** 附近是否已有实体（树/岩/浆果）遮挡 */
function crowded(x: number, z: number, minDist: number): boolean {
  const p = new THREE.Vector3(x, 0, z);
  for (const t of trees) if (t.alive && t.p.distanceTo(p) < minDist) return true;
  for (const r of rocks) if (r.alive && r.p.distanceTo(p) < minDist) return true;
  for (const b of berries) if (b.alive && b.p.distanceTo(p) < minDist) return true;
  return false;
}

export function buildBerries(): void {
  for (let i = 0; i < CFG.berryCount; i++) {
    // 尽量落在野地/矿区边缘（家园区不出浆果，保留种田压力）
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 16 + Math.random() * 16;
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r;
      const t = tileAt(px, pz);
      if (t && t.isHome) continue;
      if (crowded(px, pz, 2.2)) continue;

      const p = new THREE.Vector3(px, groundHeightAt(px, pz), pz);
      const g = new THREE.Group();
      // 三团叶簇 + 红色浆果点
      const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), berryLeafMat);
      s1.position.set(0, 0.5, 0);
      s1.scale.set(1, 0.8, 1);
      const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), berryLeafMat);
      s2.position.set(0.3, 0.38, 0.12);
      const s3 = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), berryLeafMat);
      s3.position.set(-0.28, 0.34, -0.1);
      const dots: THREE.Mesh[] = [];
      for (const [dx, dy, dz] of [[0.12, 0.62, 0.16], [-0.14, 0.56, -0.12], [0.06, 0.46, -0.2]] as const) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), berryRedMat);
        dot.position.set(dx, dy, dz);
        dots.push(dot);
      }
      g.add(s1, s2, s3, ...dots);
      g.position.copy(p);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      scene.add(g);

      const ent: BerryEnt = { p, mesh: g, alive: true, respawn: 0 };
      berries.push(ent);
      regInter(g, { kind: 'berry', ent });
      break;
    }
  }
}

// ---- 流浪者（可招募 NPC） ----
const wandererSkinMat = new THREE.MeshLambertMaterial({ color: PALETTE.unitSkin });
const wandererCloakMat = new THREE.MeshLambertMaterial({ color: PALETTE.wandererCloak });
const wandererDarkMat = new THREE.MeshLambertMaterial({ color: PALETTE.unitDark });

export function buildWanderer(): void {
  // 商站旁的空地
  const px = merchantPos.x + 5;
  const pz = merchantPos.z - 3.5;
  const p = new THREE.Vector3(px, groundHeightAt(px, pz), pz);

  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 8), wandererCloakMat);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), wandererSkinMat);
  head.position.y = 1.72;
  // 兜帽（流浪者辨识度：斗篷 + 兜帽，无工具）
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.28, 6), wandererCloakMat);
  hood.position.y = 1.78;
  const legGeo = new THREE.CapsuleGeometry(0.09, 0.26, 4, 6);
  legGeo.translate(0, -0.13, 0);
  const legL = new THREE.Mesh(legGeo, wandererDarkMat);
  legL.position.set(-0.15, 0.55, 0);
  const legR = legL.clone();
  legR.position.x = 0.15;
  // 行囊（背在身后）
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.18), wandererDarkMat);
  pack.position.set(0, 1.1, -0.32);
  g.add(torso, head, hood, legL, legR, pack);
  g.position.copy(p);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  scene.add(g);

  const ent: WandererEnt = {
    p,
    mesh: g,
    name: WANDERER_NAMES[Math.floor(Math.random() * WANDERER_NAMES.length)],
    available: true,
    respawn: 0,
  };
  setWanderer(ent);
  regInter(g, { kind: 'wanderer', ent });
}

// ---- 贸易站 ----
export function buildMerchant(): void {
  const stallY = groundHeightAt(merchantPos.x, merchantPos.z);
  merchantPos.y = stallY;

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
  shopLight.position.set(merchantPos.x, stallY + 2.2, merchantPos.z);
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
