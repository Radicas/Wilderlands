/**
 * Wilderlands · 世界生成
 * 地块网格（家园/野地/矿区三区）、地面网格线、松树、岩脉、贸易站。
 * 纯地形函数（噪声/地面高度）单一权威在 ../sim/terrain.ts，这里 re-export。
 */
import * as THREE from 'three';
import { CFG, PALETTE, SCENE, WORLD, WANDERER_NAMES } from '../config';
import type { BerryEnt, RockEnt, Tile, TreeEnt, WandererEnt } from '../types';
import { berries, interMeshes, merchantPos, rocks, setWanderer, shop, tiles, trees } from '../state';
import { scene } from './renderer';
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

// ---- 松树（InstancedMesh：220 棵树共用 2 个 draw call）----
const treeGeo = new THREE.ConeGeometry(SCENE.treeCrownR, SCENE.treeCrownH, 6);
const treeMat = new THREE.MeshLambertMaterial({ color: PALETTE.treeCrown });
const trunkGeo = new THREE.CylinderGeometry(SCENE.treeTrunkRt, SCENE.treeTrunkRb, SCENE.treeTrunkH, 5);
const trunkMat = new THREE.MeshLambertMaterial({ color: PALETTE.treeTrunk });

let trunkIM: THREE.InstancedMesh;
let crownIM: THREE.InstancedMesh;
/** 每棵树的原始 matrix（重生时恢复用），下标 = instanceId */
const treeOriginals: { trunk: THREE.Matrix4; crown: THREE.Matrix4 }[] = [];

const _dummy = new THREE.Object3D();

/** 根据 instanceId 显隐一棵树（scale=0 即不可见，但保留 raycast 命中体积？不——scale=0 后 raycast 也命中不了，正确） */
function applyTreeVisible(id: number, v: boolean): void {
  const orig = treeOriginals[id];
  if (!orig) return;
  const di = dyingTrees.findIndex((d) => d.id === id);
  if (v) {
    if (di >= 0) dyingTrees.splice(di, 1); // 重生打断补间
    trunkIM.setMatrixAt(id, orig.trunk);
    crownIM.setMatrixAt(id, orig.crown);
    trunkIM.instanceMatrix.needsUpdate = true;
    crownIM.instanceMatrix.needsUpdate = true;
  } else if (di < 0) {
    // 进入 0.4s 下沉缩小补间（gather-feedback），tickDeathAnims 落终态
    dyingTrees.push({ id, t: 0, trunk: readTransform(orig.trunk), crown: readTransform(orig.crown) });
  }
}

/** —— 消亡补间（change gather-feedback F3）：砍倒/采空 → 0.4 秒下沉缩小，替代瞬时"橡皮擦" —— */
const DEATH_DUR = 0.4;

interface DeadTransform { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
interface DyingTree { id: number; t: number; trunk: DeadTransform; crown: DeadTransform }
interface DyingRock { id: number; t: number; tr: DeadTransform }

const dyingTrees: DyingTree[] = [];
const dyingRocks: DyingRock[] = [];
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
  if (trunkIM) {
    let dirty = false;
    for (let i = dyingTrees.length - 1; i >= 0; i--) {
      const d = dyingTrees[i];
      d.t += dt;
      const k = Math.max(0, 1 - d.t / DEATH_DUR);
      for (const [tr, im] of [[d.trunk, trunkIM], [d.crown, crownIM]] as [DeadTransform, THREE.InstancedMesh][]) {
        _dp.copy(tr.p); _dp.y -= (1 - k) * 0.3;
        _ds.copy(tr.s).multiplyScalar(k);
        _dummy.position.copy(_dp); _dummy.quaternion.copy(tr.q); _dummy.scale.copy(_ds);
        _dummy.updateMatrix();
        im.setMatrixAt(d.id, _dummy.matrix);
      }
      if (d.t >= DEATH_DUR) {
        setInstanceUnder(trunkIM, d.id); setInstanceUnder(crownIM, d.id); // 地下深处终态，拾取彻底失效
        dyingTrees.splice(i, 1);
      }
      dirty = true;
    }
    if (dirty) { trunkIM.instanceMatrix.needsUpdate = true; crownIM.instanceMatrix.needsUpdate = true; }
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
  // 先收集位置（避开家园格），再一次性填充 InstancedMesh
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < WORLD.treeCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = WORLD.homeRadius * TILE * 0.8 + Math.random() * (WORLD.grid * TILE * 0.45);
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const t = tileAt(px, pz);
    if (t && t.isHome) continue;
    spots.push(new THREE.Vector3(px, groundHeightAt(px, pz), pz));
  }

  const n = spots.length;
  trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  crownIM = new THREE.InstancedMesh(treeGeo, treeMat, n);
  trunkIM.castShadow = true;
  crownIM.castShadow = true;

  spots.forEach((p, i) => {
    // trunk：几何中心半高 → 底部接地（尺寸见 config.SCENE）
    _dummy.position.set(p.x, p.y + SCENE.treeTrunkH / 2, p.z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    trunkIM.setMatrixAt(i, _dummy.matrix);
    const trunkOrig = _dummy.matrix.clone();

    // crown：压干顶略咬合，随机绕 Y 旋转
    _dummy.position.set(p.x, p.y + SCENE.treeTrunkH + SCENE.treeCrownH / 2 - 0.1, p.z);
    _dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    crownIM.setMatrixAt(i, _dummy.matrix);
    const crownOrig = _dummy.matrix.clone();

    treeOriginals.push({ trunk: trunkOrig, crown: crownOrig });

    const anchor = new THREE.Object3D();
    anchor.position.copy(p);
    bindVisible(anchor, i, applyTreeVisible);

    trees.push({ p, mesh: anchor, alive: true, respawn: 0 });
  });

  trunkIM.instanceMatrix.needsUpdate = true;
  crownIM.instanceMatrix.needsUpdate = true;
  scene.add(trunkIM, crownIM);

  // raycast 命中这两个 IM 时，按 instanceId 反查树实体
  const resolveTree = (id: number) => ({ kind: 'tree', ent: trees[id] });
  trunkIM.userData.resolveInstance = resolveTree;
  crownIM.userData.resolveInstance = resolveTree;
  interMeshes.push(trunkIM, crownIM);
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
