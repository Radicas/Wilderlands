/**
 * Wilderlands · headless 模拟层：世界初始化与主循环
 * createSimWorld：纯数据世界（3 玩家 + 狼 + 树/石/浆果 + 地块 + 商摊 + 船）。
 * simTick：每帧推进——时间/玩家任务/野狼 AI/资源重生/刷狼/农场生长/价格。
 * 无 three/DOM 依赖，node 可直接运行（spec 008）。
 */
import { CFG, START_GOLD, START_INV, START_PARTY, TREE_STUMP, TREES, UNIT_NAMES, WANDERER_NAMES, WORLD } from '../config';
import { recruitBlockers } from '../systems/recruit';
import { rollPersonality } from '../systems/personality';
export { CFG, TREES, TREE_STUMP };
export { setLogHandler } from '../systems/log';
export { transferItem } from '../systems/inventory';
import { Rng } from './rng';
import { TILE, GRID, groundHeightAt } from './terrain';
import { SimUnit } from './unit';
import { invAdd, invCanAdd, invRemove } from '../systems/inventory';
import { staminaCap } from '../systems/attributes';
import type { SimBerry, SimRock, SimTile, SimTree, SimWanderer, SimWorld } from './types';
import { buyPrice } from '../systems/trade';
import { shipReady } from '../systems/ship';
import { logMsg } from '../systems/log';

/** 商摊位置（与前端 state.merchantPos 一致：世界坐标） */
export const MERCHANT_POS = { x: 4, z: 16 };

const HALF = GRID / 2;

function tileAtIn(w: SimWorld, x: number, z: number): SimTile | undefined {
  return w.tiles.find((t) => t.x === Math.round(x / TILE) && t.z === Math.round(z / TILE));
}

/** 生成一头野狼（园区外 22..30，避开树/石/其他狼；规则同 combat.spawnWolf） */
function spawnWolf(w: SimWorld): boolean {
  if (w.wolves.length >= CFG.wolfMax) return false;
  for (let k = 0; k < 12; k++) {
    const a = w.rng.angle();
    const r = WORLD.homeRadius * 2 + 2 + w.rng.next() * 8; // 22..30
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const tile = tileAtIn(w, px, pz);
    if (tile && tile.isHome) continue;
    if (w.wolves.some((wl) => wl.dist2(px, pz) < 1.5)) continue;
    if (w.trees.some((tr) => tr.alive && Math.hypot(tr.x - px, tr.z - pz) < 1.4)) continue;
    if (w.rocks.some((rk) => rk.alive && Math.hypot(rk.x - px, rk.z - pz) < 1.4)) continue;
    w.wolves.push(new SimUnit('wolf', px, pz, '野狼'));
    return true;
  }
  return false;
}

/** 创建模拟世界（确定性：固定种子 → 相同布局与事件流；party=开局人数，默认单人开局） */
export function createSimWorld(seed = 1, party: number = START_PARTY): SimWorld {
  const rng = new Rng(seed);
  const w: SimWorld = {
    rng,
    merchant: MERCHANT_POS,
    t: 0.1,
    isNight: false,
    gold: START_GOLD,
    soldToday: { food: 0, wood: 0, stone: 0 },
    players: [],
    wolves: [],
    trees: [],
    rocks: [],
    berries: [],
    tiles: [],
    buildings: [],
    wanderer: null,
    ship: { wood: 0, stone: 0, done: false },
    events: [],
  };

  // 开局拓荒者（初始背包；人数 = party，默认 START_PARTY，位置与前端 createPlayers 一致）
  for (let i = 0; i < party; i++) {
    w.players.push(new SimUnit('player', (i - 1) * 1.6, 1.2 + i * 0.3, UNIT_NAMES[i % UNIT_NAMES.length], START_INV));
  }

  // 野狼 3 头
  for (let i = 0; i < 3; i++) spawnWolf(w);

  // 森林（规则同 world.buildTrees：园区外、treeMinGap 拒绝采样、i%4 物种映射——forest-life 双轨镜像）
  {
    const SPECIES_MAP = [0, 0, 1, 2];
    let tries = 0;
    while (w.trees.length < WORLD.treeCount && tries++ < WORLD.treeCount * 4) {
      const a = rng.angle();
      const r = WORLD.homeRadius * TILE * 0.8 + rng.next() * (WORLD.grid * TILE * 0.45);
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r;
      const t = tileAtIn(w, px, pz);
      if (t && t.isHome) continue;
      if (w.trees.some((tr) => Math.hypot(tr.x - px, tr.z - pz) < WORLD.treeMinGap)) continue;
      w.trees.push({ x: px, z: pz, alive: true, respawn: 0, species: SPECIES_MAP[w.trees.length % 4], phase: 'mature' });
    }
  }

  // 岩脉（规则同 world.buildRocks：r = 22.4 + rand*33.6）
  for (let i = 0; i < WORLD.rockCount; i++) {
    const a = rng.angle();
    const r = WORLD.wildRadius * TILE * 0.7 + rng.next() * (WORLD.grid * TILE * 0.35);
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const t = tileAtIn(w, px, pz);
    if (t && t.isHome) continue;
    w.rocks.push({ x: px, z: pz, hp: 3, alive: true, respawn: 0 });
  }

  // 浆果丛（规则同 world.buildBerries：r = 16 + rand*16，避开家园与拥挤点）
  for (let i = 0; i < CFG.berryCount; i++) {
    for (let k = 0; k < 20; k++) {
      const a = rng.angle();
      const r = 16 + rng.next() * 16;
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r;
      const t = tileAtIn(w, px, pz);
      if (t && t.isHome) continue;
      if (w.berries.some((b) => b.alive && Math.hypot(b.x - px, b.z - pz) < 2.2)) continue;
      w.berries.push({ x: px, z: pz, alive: true, respawn: 0 });
      break;
    }
  }

  // 地块网格（家园半径 10 格）
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const gx = x - HALF;
      const gz = z - HALF;
      w.tiles.push({ x: gx, z: gz, state: 0, grow: 0, isHome: Math.hypot(gx, gz) <= WORLD.homeRadius });
    }
  }

  // 流浪者（可招募）
  const wanderer: SimWanderer = {
    x: MERCHANT_POS.x - 3,
    z: MERCHANT_POS.z + 2,
    name: WANDERER_NAMES[0],
    available: true,
    respawn: 0,
  };
  w.wanderer = wanderer;

  return w;
  // 性格由种子流确定性分配（spec 011：同 seed 同性格）；放在所有生成之后，避免扰动布局 rng 流
  for (const p of w.players) p.personality = rollPersonality(rng.next(), rng.next(), rng.next());


}

/** 由世界坐标查地块（模拟用） */
export { tileAtIn };

// ===================== 命令（脚本/CLI 驱动） =====================

export function simMove(w: SimWorld, u: SimUnit, x: number, z: number): void {
  u.task = { type: 'move', pos: { x, z }, workT: 0 };
  logMsg(u.name + ' 前往 (' + x.toFixed(1) + ',' + z.toFixed(1) + ')');
}

export function simGatherTree(w: SimWorld, u: SimUnit, idx: number): void {
  const tree = w.trees[idx];
  if (!tree || !tree.alive || tree.phase !== 'mature') { logMsg('那棵树已经没了'); return; } // 免砍门（forest-life）
  const dx = tree.x - u.x;
  const dz = tree.z - u.z;
  const d = Math.hypot(dx, dz) || 1;
  u.task = { type: 'gather', kind: 'tree', target: idx, pos: { x: tree.x - (dx / d) * 1.5, z: tree.z - (dz / d) * 1.5 }, workT: 0, workDur: TREES[tree.species].workDur };
  logMsg(u.name + ' 去砍树 #' + idx);
}

export function simGatherRock(w: SimWorld, u: SimUnit, idx: number): void {
  const rock = w.rocks[idx];
  if (!rock || !rock.alive) { logMsg('这块石头已经采空了'); return; }
  const dx = rock.x - u.x;
  const dz = rock.z - u.z;
  const d = Math.hypot(dx, dz) || 1;
  u.task = { type: 'gather', kind: 'rock', target: idx, pos: { x: rock.x - (dx / d) * 1.5, z: rock.z - (dz / d) * 1.5 }, workT: 0, workDur: 1.6 };
  logMsg(u.name + ' 去凿石 #' + idx);
}

export function simGatherBerry(w: SimWorld, u: SimUnit, idx: number): void {
  const b = w.berries[idx];
  if (!b || !b.alive) { logMsg('这丛浆果已经没了'); return; }
  const dx = b.x - u.x;
  const dz = b.z - u.z;
  const d = Math.hypot(dx, dz) || 1;
  u.task = { type: 'gather', kind: 'berry', target: idx, pos: { x: b.x - (dx / d) * 1.3, z: b.z - (dz / d) * 1.3 }, workT: 0, workDur: 1.2 };
  logMsg(u.name + ' 去采浆果 #' + idx);
}

export function simAttackWolf(w: SimWorld, u: SimUnit, wolfIdx: number): void {
  const wolf = w.wolves[wolfIdx];
  if (!wolf || wolf.dead) { logMsg('那头狼已经不在了'); return; }
  u.task = { type: 'attack', target: wolfIdx, targetRole: 'wolf', pos: { x: wolf.x, z: wolf.z }, workT: 0 };
  u.targetPos = { x: wolf.x, z: wolf.z };
  logMsg(u.name + ' 攻击野狼 #' + wolfIdx);
}

export function simTrade(w: SimWorld, u: SimUnit): void {
  u.task = { type: 'trade', pos: { x: MERCHANT_POS.x, z: MERCHANT_POS.z }, workT: 0 };
  logMsg(u.name + ' 前往贸易站');
}

/** 在贸易站卖一件物品（等价前端 sellOne；价格公式同 systems/trade） */
export function simSell(w: SimWorld, u: SimUnit, id: 'food' | 'wood' | 'stone'): boolean {
  const have = u.inv[id] ?? 0;
  if (have < 1) { logMsg('背包里没有可卖的'); return false; }
  const p = buyPrice(id, w.soldToday[id]);
  u.inv[id] = have - 1;
  if (u.inv[id] === 0) delete u.inv[id];
  w.soldToday[id] += 1;
  w.gold += p;
  logMsg('出售 ' + id + ' +' + p + ' 金币（成交量 ' + w.soldToday[id] + '）');
  return true;
}

/** 向船投入材料（等价前端 donate；需要人在船边） */
export function simDonateShip(w: SimWorld, u: SimUnit, id: 'wood' | 'stone'): boolean {
  if (w.ship.done) return false;
  const amount = id === 'wood' ? CFG.shipDonateWood : CFG.shipDonateStone;
  if (Math.hypot(u.x - CFG.shipPos.x, u.z - CFG.shipPos.z) > CFG.shipNearDist) {
    logMsg('人还没走到船边，先过去再修');
    return false;
  }
  const have = u.inv[id] ?? 0;
  if (have < amount) { logMsg('背包里' + (id === 'wood' ? '木材' : '石头') + '不足 ' + amount + ' 个'); return false; }
  u.inv[id] = have - amount;
  if (u.inv[id] === 0) delete u.inv[id];
  // 直接写世界状态（donateToShip 是前端全局单例，sim 世界自持 ship）
  if (id === 'wood') w.ship.wood = Math.min(CFG.shipWoodNeed, w.ship.wood + amount);
  else w.ship.stone = Math.min(CFG.shipStoneNeed, w.ship.stone + amount);
  logMsg((id === 'wood' ? '木材' : '石头') + ' -' + amount + '，修船进度 ' + w.ship.wood + '/' + CFG.shipWoodNeed + ' ' + w.ship.stone + '/' + CFG.shipStoneNeed);
  if (shipReady(w.ship.wood, w.ship.stone)) {
    w.ship.done = true;
    logMsg('咣当！破船翻正了——主线达成。');
  }
  return true;
}

/** 播种（等价前端 plantTile 的数值部分） */
export function simPlant(w: SimWorld, u: SimUnit, tileIdx: number): boolean {
  const tile = w.tiles[tileIdx];
  if (!tile || tile.state !== 0) { logMsg('这块地已有作物或正在生长'); return false; }
  const seeds = u.inv.seed ?? 0;
  if (seeds < 1) { logMsg('种子不足，去贸易站买一些吧'); return false; }
  u.inv.seed = seeds - 1;
  if (u.inv.seed === 0) delete u.inv.seed;
  tile.state = 1;
  tile.grow = 0;
  logMsg(u.name + ' 播种完成，等待生长');
  return true;
}

/** 附近是否已有建筑（间距 1.6，规则同 build.nearBuilding） */
function nearBuilding(w: SimWorld, x: number, z: number): boolean {
  return w.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < 1.6);
}

/** 建造围栏（等价前端 buildFence 的数值部分：扣 2 木材） */
export function simBuildFence(w: SimWorld, u: SimUnit, x: number, z: number): boolean {
  if (nearBuilding(w, x, z)) { logMsg('这里太挤了，换个地方'); return false; }
  if (!invRemove(u, 'wood', CFG.fenceCost)) {
    logMsg('木材不足（围栏需 2）');
    return false;
  }
  w.buildings.push({ type: 'fence', x, z });
  logMsg('建造围栏，木材 -' + CFG.fenceCost);
  return true;
}

/** 建造木屋（等价前端 buildHouse 的数值部分：10 木 + 5 石，石头不足回滚木材） */
export function simBuildHouse(w: SimWorld, u: SimUnit, x: number, z: number): boolean {
  if (nearBuilding(w, x, z)) { logMsg('这里太挤了，换个地方'); return false; }
  if (!invRemove(u, 'wood', CFG.houseCostWood)) {
    logMsg('木屋需要木材 10 + 石头 5');
    return false;
  }
  if (!invRemove(u, 'stone', CFG.houseCostStone)) {
    u.inv.wood = (u.inv.wood ?? 0) + CFG.houseCostWood; // 回滚已扣木材
    logMsg('木屋需要木材 10 + 石头 5');
    return false;
  }
  w.buildings.push({ type: 'house', x, z });
  logMsg('木屋建成，附近拓荒者缓慢回血');
  return true;
}

/** 招募流浪者（等价前端 commands："人很贵"条件门：屋顶+余粮+金币全达成，才招空背包新人；60 秒后新流浪者出现） */
export function simRecruit(w: SimWorld): boolean {
  const wd = w.wanderer;
  if (!wd || !wd.available) { logMsg('流浪者还在路上'); return false; }
  const blockers = recruitBlockers({
    houses: w.buildings.filter((b) => b.type === 'house').length,
    teamFood: w.players.reduce((s, u) => s + (u.inv.food ?? 0) + (u.inv.berry ?? 0), 0),
    gold: w.gold,
  });
  if (blockers.length) { logMsg('想招人，还得再熬一熬：' + blockers.join('；')); return false; }
  w.gold -= CFG.recruitCost;
  wd.available = false;
  wd.respawn = CFG.wandererRespawn;
  const nu = new SimUnit('player', wd.x, wd.z, wd.name, {});
  nu.personality = rollPersonality(w.rng.next(), w.rng.next(), w.rng.next()); // 入队即定型（spec 011）
  w.players.push(nu);
  logMsg(wd.name + ' 加入了你的小队！');
  return true;
}

/** 购买木矛（等价前端 trade 买矛：8 金，攻击 +3，装备给该角色） */
export function simBuySpear(w: SimWorld, u: SimUnit): boolean {
  if (u.hasSpear) { logMsg(u.name + ' 已经带着木矛了'); return false; }
  if (w.gold < CFG.spearPrice) {
    logMsg('金币不足，木矛 ' + CFG.spearPrice + ' 金（现在只有 ' + w.gold + '）');
    return false;
  }
  w.gold -= CFG.spearPrice;
  u.hasSpear = true;
  u.atkDmg = CFG.atkDmg + CFG.spearAtk;
  logMsg(u.name + ' 买下木矛，攻击 +' + CFG.spearAtk);
  return true;
}

/** 购买种子（等价前端 trade 买种子：2 金/个，背包满拒绝） */
export function simBuySeed(w: SimWorld, u: SimUnit, n = 1): boolean {
  const need = w.gold - n * CFG.seedPrice;
  if (need < 0) {
    logMsg('金币不足（种子需 ' + CFG.seedPrice + ' 金）');
    return false;
  }
  if (!invCanAdd(u, 'seed', n)) {
    logMsg(u.name + ' 背包已满，放不下更多种子');
    return false;
  }
  w.gold -= n * CFG.seedPrice;
  invAdd(u, 'seed', n);
  logMsg('购入种子 ×' + n);
  return true;
}

/** 进食（等价前端 economy.eatFood：从首位背包扣，食物优先/浆果兜底，全员饥饿 +50） */
export function simEat(w: SimWorld, eaters: SimUnit[]): boolean {
  const alive = eaters.filter((u) => !u.down);
  if (!alive.length) return false;
  const from = alive[0];
  const need = alive.length;
  const food = from.inv.food ?? 0;
  const berry = from.inv.berry ?? 0;
  if (food + berry < need) {
    logMsg('食物不足（' + need + ' 人各需 1 份，背包还有 ' + food + ' 食物 + ' + berry + ' 浆果）');
    return false;
  }
  const takeFood = Math.min(food, need);
  const takeBerry = need - takeFood;
  if (takeFood > 0) from.inv.food = food - takeFood;
  if (takeBerry > 0) from.inv.berry = berry - takeBerry;
  for (const u of alive) {
    u.hunger = Math.min(100, u.hunger + CFG.eatHeal);
    // 进食双收益：回血 + 回体力（spec 010）
    u.attrs.stamina = Math.min(staminaCap(u), u.attrs.stamina + CFG.staminaEat);
  }
  logMsg(alive.length + ' 名拓荒者进食，饥饿 +' + CFG.eatHeal + '，体力 +' + CFG.staminaEat);
  return true;
}

// ===================== 主循环 =====================

/** 每帧推进世界（规则对照 spec 008 §3） */
export function simTick(w: SimWorld, dt: number): void {
  // —— 时间与昼夜（跨日价格回升） ——
  const prevT = w.t;
  w.t = (w.t + dt / CFG.daySeconds) % 1;
  w.isNight = w.t >= CFG.nightStartRatio;
  if (w.t < prevT) {
    for (const k of Object.keys(w.soldToday) as ('food' | 'wood' | 'stone')[]) {
      w.soldToday[k] = Math.floor(w.soldToday[k] * CFG.tradeRecover);
    }
  }

  // —— 玩家：任务 + 倒地恢复 + 饥饿 ——
  for (const u of w.players) {
    u.idleTick(w, dt);
    u.taskTick(w, dt);
  }

  // —— 野狼 AI（规则同 combat.updateWolves） ——
  const detect = w.isNight ? 18 : 11;
  for (const wolf of w.wolves) {
    if (wolf.dead || wolf.down) continue;
    let nearest: SimUnit | null = null;
    let nd = detect;
    for (const u of w.players) {
      const d = wolf.dist2(u.x, u.z);
      if (d < nd && !u.down) {
        nd = d;
        nearest = u;
      }
    }
    if (nearest) {
      if (wolf.dist2(nearest.x, nearest.z) < 1.7) {
        wolf.attackT -= dt;
        if (wolf.attackT <= 0) {
          wolf.attackT = 1;
          nearest.takeDamage(CFG.wolfDmg, wolf);
          logMsg(wolf.name + ' 咬伤了 ' + nearest.name);
        }
        wolf.lookAtTarget(nearest.x, nearest.z);
      } else {
        wolf.moveToward(nearest.x, nearest.z, dt * (w.isNight ? 1.15 : 1));
      }
    } else {
      if (!wolf.wanderPos || wolf.dist2(wolf.wanderPos.x, wolf.wanderPos.z) < 0.5) {
        wolf.wanderT -= dt;
        if (wolf.wanderT <= 0) {
          const a = w.rng.angle();
          const r = 3 + w.rng.next() * 4;
          wolf.wanderPos = { x: wolf.x + Math.cos(a) * r, z: wolf.z + Math.sin(a) * r };
          wolf.wanderT = 2 + w.rng.next() * 3;
        }
      } else if (wolf.wanderPos) {
        wolf.moveToward(wolf.wanderPos.x, wolf.wanderPos.z, dt);
      }
    }
  }
  // 移除死亡狼
  for (let i = w.wolves.length - 1; i >= 0; i--) {
    if (w.wolves[i].dead) {
      logMsg('野狼 #' + i + ' 被移除了');
      w.wolves.splice(i, 1);
    }
  }

  // —— 资源重生（规则同 combat.updateWorld：树走 stump→sprout→young→mature 阶段机） ——
  for (const tree of w.trees) {
    if (tree.phase !== 'mature') {
      tree.respawn -= dt;
      if (tree.respawn <= 0) {
        const dur = (TREES[tree.species].toMature - TREE_STUMP) / 2;
        if (tree.phase === 'stump') { tree.phase = 'sprout'; tree.alive = true; tree.respawn = dur; }
        else if (tree.phase === 'sprout') { tree.phase = 'young'; tree.respawn = dur; }
        else { tree.phase = 'mature'; tree.respawn = 0; }
      }
    }
  }
  for (const rock of w.rocks) {
    if (!rock.alive) {
      rock.respawn -= dt;
      if (rock.respawn <= 0) {
        rock.alive = true;
        rock.hp = 3;
      }
    }
  }
  for (const b of w.berries) {
    if (!b.alive) {
      b.respawn -= dt;
      if (b.respawn <= 0) b.alive = true;
    }
  }
  if (w.wanderer && !w.wanderer.available) {
    w.wanderer.respawn -= dt;
    if (w.wanderer.respawn <= 0) w.wanderer.available = true;
  }

  // —— 刷狼（夜晚更快） ——
  if (!w.wolfSpawnDisabled) {
    w._wolfSpawnT = (w._wolfSpawnT ?? 0) + dt;
    const interval = CFG.wolfSpawn * (w.isNight ? 0.55 : 1);
    if ((w._wolfSpawnT ?? 0) >= interval) {
      w._wolfSpawnT = 0;
      spawnWolf(w);
    }
  }

  // —— 农场生长（规则同 farm.updateFarms） ——
  for (const t of w.tiles) {
    if (t.state === 0 || t.state === 3) continue;
    t.grow += dt / (t.isHome ? CFG.growHome : CFG.growWild);
    if (t.grow >= 0.45 && t.state === 1) t.state = 2;
    if (t.grow >= 1) t.state = 3;
  }
}
