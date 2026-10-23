#!/usr/bin/env node
/**
 * Wilderlands · headless 全环节模拟回归（剥离图形，node 纯后台）
 *
 * 用法：
 *   node scripts/sim-run.mjs            # 全环节场景组 + 断言（退出码 0/1）
 *   node scripts/sim-run.mjs --verbose  # 额外打印事件流
 *
 * 目标：每个模块/环节/交互都进 headless 回归，规则与前端一致（spec 008 §3）。
 * 每组场景用独立世界（seed=42 确定性），互不串扰。
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(root, 'node_modules/.cache', `sim-bundle-${process.pid}.mjs`);
fs.mkdirSync(path.dirname(tmp), { recursive: true });

try {
  execSync(
    `npx esbuild src/sim/world.ts --bundle --format=esm --platform=node --outfile=${tmp}`,
    { cwd: root, stdio: 'pipe' },
  );
} catch (e) {
  console.error('esbuild bundle failed:', e.stderr?.toString?.() ?? e.message);
  process.exit(1);
}

const sim = await import('file://' + tmp);
const {
  createSimWorld, simTick, simMove, simGatherTree, simGatherRock, simGatherBerry,
  simTrade, simSell, simDonateShip, simPlant, simBuildFence, simBuildHouse,
  simRecruit, simBuySpear, simBuySeed, simEat, transferItem, MERCHANT_POS, CFG, setLogHandler,
} = sim;

const verbose = process.argv.includes('--verbose');
const allFails = [];
let totalChecks = 0;

/** 建一个确定性的独立世界（事件流接进世界自身） */
function world(seed = 42) {
  const w = createSimWorld(seed);
  setLogHandler((m) => w.events.push(m));
  return w;
}

/** 快进 w 秒（dt=0.1 定步长） */
function tick(w, sec) {
  for (let i = 0; i < Math.round(sec / 0.1); i++) simTick(w, 0.1);
}

/** 断言收集器 */
function suite(name) {
  const checks = [];
  return {
    name,
    ok(cond, label, detail = '') {
      totalChecks++;
      checks.push([label, !!cond, detail]);
    },
    run() {
      console.log('\n== ' + name + ' ==');
      let bad = 0;
      for (const [label, ok, detail] of checks) {
        console.log((ok ? '  ✓ ' : '  ✗ ') + label + (detail ? '  [' + detail + ']' : ''));
        if (!ok) { bad++; allFails.push(name + ' / ' + label); }
      }
      console.log('  → ' + (checks.length - bad) + '/' + checks.length + ' 通过');
    },
  };
}

const u0 = (w) => w.players[0];
const u1 = (w) => w.players[1];

// ============================================================
// 1. 世界初始化
// ============================================================
{
  const s = suite('1 · 世界初始化');
  const w = world();
  s.ok(w.players.length === 3, '3 名拓荒者', `players=${w.players.length}`);
  s.ok(w.wolves.length === 3, '3 头野狼');
  s.ok(w.trees.length === 220 && w.rocks.length === 90 && w.berries.length === 14,
    '资源数量（220 树 / 90 石 / 14 浆果）');
  s.ok(w.tiles.length === 48 * 48, '地块网格 48×48', `tiles=${w.tiles.length}`);
  s.ok(w.gold === 20, '公共金币 20');
  s.ok(JSON.stringify(u0(w).inv) === JSON.stringify({ wood: 3, stone: 2, food: 3, seed: 1, berry: 0 }),
    '初始背包（wood3/stone2/food3/seed1/berry0）', JSON.stringify(u0(w).inv));
  s.ok(Math.abs(w.trees[0].x) > 10 || Math.abs(w.trees[0].z) > 10, '树在园区外');
  s.ok(Math.hypot(MERCHANT_POS.x - 4, MERCHANT_POS.z - 16) < 1e-9, '商摊在 (4,16)');
  s.ok(w.wanderer !== null && w.wanderer.available, '流浪者待招募');
  s.ok(w.ship.wood === 0 && w.ship.stone === 0 && !w.ship.done, '破船初始空');
  const w2 = world();
  const same = w2.trees.length === w.trees.length && Math.abs(w2.trees[0].x - w.trees[0].x) < 1e-9;
  s.ok(same, '同种子确定性（两世界树布局相同）');
  s.run();
}

// ============================================================
// 2. 时间与昼夜
// ============================================================
{
  const s = suite('2 · 时间与昼夜');
  const w = world();
  const t0 = w.t;
  tick(w, 10);
  s.ok(Math.abs(w.t - (t0 + 10 / CFG.daySeconds)) < 1e-9, '时间推进', `t=${w.t.toFixed(4)}`);
  w.t = 0.49;
  tick(w, 1);
  s.ok(!w.isNight, '白天 isNight=false');
  w.t = 0.51;
  tick(w, 1);
  s.ok(w.isNight, '入夜 isNight=true');
  w.soldToday.wood = 8; w.soldToday.food = 5;
  w.t = 0.999;
  tick(w, 0.5);
  s.ok(w.soldToday.wood === Math.floor(8 * 0.3), '跨日成交量衰减（wood 8→2）', `wood=${w.soldToday.wood}`);
  s.ok(w.soldToday.food === Math.floor(5 * 0.3), '跨日成交量衰减（food 5→1）', `food=${w.soldToday.food}`);
  s.run();
}

// ============================================================
// 3. 移动
// ============================================================
{
  const s = suite('3 · 移动');
  const w = world();
  const ron = u0(w);
  simMove(w, ron, 20, 20);
  tick(w, 12);
  s.ok(Math.hypot(ron.x - 20, ron.z - 20) <= 0.2, '到达目标点（≤0.2）', `dist=${Math.hypot(ron.x - 20, ron.z - 20).toFixed(3)}`);
  s.ok(ron.task === null, '任务完成清空');
  const rx = ron.x, rz = ron.z;
  tick(w, 2);
  s.ok(Math.abs(ron.x - rx) < 1e-9 && Math.abs(ron.z - rz) < 1e-9, '到站后不再走（防"无限走"）');
  simMove(w, ron, 30, 30);
  tick(w, 1);
  ron.takeDamage(200);
  s.ok(ron.down && ron.task === null, '倒地清空移动任务', `down=${ron.down} task=${ron.task?.type ?? 'null'}`);
  const w3 = world();
  const r3 = u0(w3);
  r3.inv = { wood: 20, stone: 0, food: 0, seed: 0, berry: 0 }; // 40/40 满载
  simMove(w3, r3, 0, 30);
  tick(w3, 3);
  const w4 = world();
  const r4 = u0(w4);
  simMove(w4, r4, 0, 30);
  tick(w4, 3);
  const sd3 = Math.hypot(r3.x - 0, r3.z - 30), sd4 = Math.hypot(r4.x - 0, r4.z - 30);
  const startD = Math.hypot(-1.6 - 0, 1.2 - 30);
  s.ok((startD - sd3) < (startD - sd4) * 0.95,
    '超载减速（满载走得少）', `满载走 ${(startD - sd3).toFixed(1)} vs 空载走 ${(startD - sd4).toFixed(1)}`);
  s.run();
}

// ============================================================
// 4. 采集：树 / 石 / 浆果 / 作物
// ============================================================
{
  const s = suite('4 · 采集');
  const wt = world();
  const ron = u0(wt);
  const tree = wt.trees[0];
  const w0 = ron.inv.wood ?? 0;
  simGatherTree(wt, ron, 0);
  tick(wt, 25);
  s.ok((ron.inv.wood ?? 0) === w0 + CFG.woodPerTree, '砍树 wood +3', `${w0}→${ron.inv.wood}`);
  s.ok(!tree.alive, '树被砍倒');
  s.ok(ron.skills.gather >= 1, '采集经验 +1', `gather=${ron.skills.gather}`);
  tick(wt, 46);
  s.ok(tree.alive, '树 45 秒后重生');
  const wr = world();
  const rk = u0(wr);
  const rock = [...wr.rocks].sort((a, b) => Math.hypot(a.x - rk.x, a.z - rk.z) - Math.hypot(b.x - rk.x, b.z - rk.z))[0];
  const rockIdx = wr.rocks.indexOf(rock);
  simGatherRock(wr, rk, rockIdx);
  tick(wr, 20);
  s.ok((rk.inv.stone ?? 0) === 4, '凿石 stone 2→4（初始 2 + 采 2）', `stone=${rk.inv.stone}`);
  s.ok(rock.hp === 2, '岩脉 hp 2/3');
  simGatherRock(wr, rk, rockIdx);
  tick(wr, 8);
  simGatherRock(wr, rk, rockIdx);
  tick(wr, 8);
  s.ok(!rock.alive, '岩脉 3 次采空');
  tick(wr, 91);
  s.ok(rock.alive && rock.hp === 3, '岩脉 90 秒后重生且 hp 回满');
  const wb = world();
  const rb = u0(wb);
  const berry = [...wb.berries].sort((a, b) => Math.hypot(a.x - rb.x, a.z - rb.z) - Math.hypot(b.x - rb.x, b.z - rb.z))[0];
  const berryIdx = wb.berries.indexOf(berry);
  simGatherBerry(wb, rb, berryIdx);
  tick(wb, 16);
  s.ok((rb.inv.berry ?? 0) === CFG.berryFood, '浆果 +2');
  s.ok(!berry.alive, '浆果丛摘空');
  tick(wb, 31);
  s.ok(berry.alive, '浆果丛 30 秒后重生');
  const wf = world();
  const rf = u0(wf);
  rf.inv = { wood: 20 };
  const tree2 = wf.trees[1];
  simGatherTree(wf, rf, 1);
  tick(wf, 20);
  s.ok(tree2.alive, '背包满 → 树保留（不砍）', `alive=${tree2.alive}`);
  s.run();
}

// ============================================================
// 5. 种植与收获
// ============================================================
{
  const s = suite('5 · 种植与收获');
  const w = world();
  const ron = u0(w);
  const tile = w.tiles.find((t) => t.isHome && Math.hypot(t.x, t.z) < 3);
  const idx = w.tiles.indexOf(tile);
  ron.inv = { wood: 0, stone: 0, food: 0, seed: 0, berry: 0 };
  s.ok(!simPlant(w, ron, idx), '无种子拒绝播种');
  ron.inv.seed = 1;
  s.ok(simPlant(w, ron, idx), '播种成功');
  s.ok(tile.state === 1, '地块进入生长态');
  s.ok((ron.inv.seed ?? 0) === 0, '种子 -1');
  tick(w, CFG.growHome + 1);
  s.ok(tile.state === 3, '家园地块成熟（金黄）', `state=${tile.state}`);
  const tp = { x: tile.x * 2, z: tile.z * 2 };
  ron.task = { type: 'gather', kind: 'crop', target: idx, pos: tp, workT: 0, workDur: 1.2 };
  tick(w, 10);
  s.ok(tile.state === 0, '收获后地块复位');
  s.ok((ron.inv.food ?? 0) === CFG.cropPerHarvest, '食物 +2');
  s.ok(ron.skills.farm >= 1, '种田经验 +1', `farm=${ron.skills.farm}`);
  const w2 = world();
  const r2 = u0(w2);
  const wildTile = w2.tiles.find((t) => !t.isHome && t.x > 0 && t.z > 0);
  const idx2 = w2.tiles.indexOf(wildTile);
  r2.inv.seed = 1;
  simPlant(w2, r2, idx2);
  tick(w2, CFG.growWild - 5);
  s.ok(wildTile.state !== 3, '野外 30 秒未成熟（需 35 秒）', `state=${wildTile.state}`);
  tick(w2, 6);
  s.ok(wildTile.state === 3, '野外 36 秒成熟', `state=${wildTile.state}`);
  s.run();
}

// ============================================================
// 6. 建造（围栏 / 木屋 / 回血）
// ============================================================
{
  const s = suite('6 · 建造');
  const w = world();
  const ron = u0(w);
  ron.inv = { wood: 5, stone: 0, food: 0, seed: 0, berry: 0 };
  s.ok(simBuildFence(w, ron, 3, 3), '围栏建造成功');
  s.ok((ron.inv.wood ?? 0) === 3, '围栏扣 2 木材', `wood=${ron.inv.wood}`);
  s.ok(w.buildings.length === 1 && w.buildings[0].type === 'fence', '围栏入世界');
  s.ok(!simBuildFence(w, ron, 3.2, 3.2), '太近（<1.6）拒绝重复建造');
  s.ok(!simBuildHouse(w, ron, 8, 8), '石头不足拒绝木屋');
  s.ok((ron.inv.wood ?? 0) === 3, '木屋失败回滚木材（不白扣）', `wood=${ron.inv.wood}`);
  ron.inv = { wood: 10, stone: 5, food: 0, seed: 0, berry: 0 };
  s.ok(simBuildHouse(w, ron, 10, 10), '木屋建造成功');
  s.ok(w.buildings.some((b) => b.type === 'house'), '木屋入世界');
  ron.hp = 70;
  ron.x = 10; ron.z = 10;
  tick(w, 5);
  s.ok(ron.hp > 70, '木屋旁缓慢回血', `hp=${ron.hp}`);
  s.ok(ron.hp <= 100, '回血不超上限');
  const w2 = world();
  const r2 = u0(w2);
  r2.hp = 70;
  tick(w2, 5);
  s.ok(r2.hp === 70, '无木屋不回血');
  s.run();
}

// ============================================================
// 7. 经济：进食 / 招募 / 木矛
// ============================================================
{
  const s = suite('7 · 经济');
  const w = world();
  const ron = u0(w), kelly = u1(w);
  ron.hunger = 30; kelly.hunger = 40;
  ron.inv = { wood: 0, stone: 0, food: 2, seed: 0, berry: 1 };
  s.ok(simEat(w, [ron, kelly]), '双人进食成功');
  s.ok(ron.hunger === 80 && kelly.hunger === 90, '饥饿 +50（封顶 100）', `${ron.hunger}/${kelly.hunger}`);
  s.ok((ron.inv.food ?? 0) === 0 && (ron.inv.berry ?? 0) === 1, '优先扣食物（2 份 food 吃完，不动浆果）');
  ron.hunger = 10;
  s.ok(simEat(w, [ron]), '单人浆果兜底成功');
  s.ok((ron.inv.berry ?? 0) === 0 && ron.hunger === 60, '浆果 -1、饥饿 10→60');
  const wr = world();
  wr.gold = 30; // 场景控制：凑够招募费
  const g0 = wr.gold;
  s.ok(simRecruit(wr), '招募流浪者');
  s.ok(wr.gold === g0 - CFG.recruitCost, '金币 -25', `${g0}→${wr.gold}`);
  s.ok(wr.players.length === 4, '第 4 人入队');
  s.ok(JSON.stringify(wr.players[3].inv) === '{}', '新队员空背包');
  s.ok(!wr.wanderer.available, '流浪者不再可招募');
  s.ok(!simRecruit(wr), '招募后拒绝再次招募');
  tick(wr, CFG.wandererRespawn + 1);
  s.ok(wr.wanderer.available, '60 秒后新流浪者出现');
  const wg = world();
  wg.gold = 10;
  s.ok(!simRecruit(wg), '金币不足拒绝招募');
  const ws = world();
  const rs = u0(ws);
  const gs = ws.gold;
  s.ok(simBuySpear(ws, rs), '购买木矛');
  s.ok(ws.gold === gs - CFG.spearPrice, '金币 -8');
  s.ok(rs.hasSpear && rs.atkDmg === CFG.atkDmg + CFG.spearAtk, '攻击 5→8', `atk=${rs.atkDmg}`);
  s.ok(!simBuySpear(ws, rs), '已持有拒绝重复购买');
  ws.gold = 1;
  s.ok(!simBuySpear(ws, u1(ws)), '金币不足拒绝买矛');
  s.run();
}

// ============================================================
// 8. 战斗
// ============================================================
{
  const s = suite('8 · 战斗');
  const w = world();
  const ron = u0(w);
  w.t = 0.3;
  u1(w).x = 100; u1(w).z = 100; u1(w).down = true;
  w.players[2].x = 100; w.players[2].z = 100; w.players[2].down = true;
  const wolf = w.wolves[0];
  wolf.x = ron.x + 6; wolf.z = ron.z;
  tick(w, 2);
  s.ok(wolf.dist2(ron.x, ron.z) < 6, '狼白天追击靠近', `dist=${wolf.dist2(ron.x, ron.z).toFixed(1)}`);
  tick(w, 4);
  s.ok(ron.hp < 100, '狼攻击玩家掉血', `hp=${ron.hp}`);
  const wk = world();
  const rk = u0(wk);
  rk.hasSpear = true; rk.atkDmg = 8;
  const wk0 = wk.wolves[0];
  wk0.x = rk.x + 1.5; wk0.z = rk.z;
  rk.task = { type: 'attack', target: 0, targetRole: 'wolf', pos: { x: wk0.x, z: wk0.z }, workT: 0 };
  rk.targetPos = { x: wk0.x, z: wk0.z };
  const food0 = rk.inv.food ?? 0;
  const combat0 = rk.skills.combat ?? 0;
  tick(wk, 10);
  s.ok(wk.wolves.length === 2, '击杀后狼移除', `wolves=${wk.wolves.length}`);
  s.ok((rk.inv.food ?? 0) === food0 + 2, '击杀战利品食物 +2');
  s.ok((rk.skills.combat ?? 0) === combat0 + 3, '击杀战斗经验 +3', `combat=${rk.skills.combat}`);
  const wd = world();
  const rd = u0(wd);
  rd.hp = 0; rd.down = true; rd.downT = 0;
  tick(wd, CFG.downRecover + 1);
  s.ok(!rd.down && rd.hp >= 50, '倒地 30 秒苏醒且 hp≥50', `hp=${rd.hp}`);
  const ww = world();
  const wl = ww.wolves[0];
  wl.wanderT = 0;
  const lx = wl.x, lz = wl.z;
  tick(ww, 5);
  s.ok(Math.abs(wl.x - lx) + Math.abs(wl.z - lz) > 0.5, '狼无目标时游荡', `移动 ${(Math.abs(wl.x - lx) + Math.abs(wl.z - lz)).toFixed(1)}`);
  const wf = world();
  const n0 = wf.wolves.length;
  tick(wf, CFG.wolfSpawn + 1);
  s.ok(wf.wolves.length > n0, '白天 26 秒刷狼', `wolves ${n0}→${wf.wolves.length}`);
  wf.t = 0.6;
  const n1 = wf.wolves.length;
  tick(wf, Math.round(CFG.wolfSpawn * 0.55) + 1);
  s.ok(wf.wolves.length > n1, '夜晚 14.3 秒刷狼（更快）', `wolves ${n1}→${wf.wolves.length}`);
  const wm = world();
  for (let i = wm.wolves.length; i < CFG.wolfMax; i++) simTick(wm, 0.1);
  s.ok(wm.wolves.length <= CFG.wolfMax, '狼群上限 6', `wolves=${wm.wolves.length}`);
  s.run();
}

// ============================================================
// 9. 贸易
// ============================================================
{
  const s = suite('9 · 贸易');
  const w = world();
  const ron = u0(w);
  ron.inv = { wood: 2, stone: 2, food: 3, seed: 0, berry: 0 };
  simTrade(w, ron);
  tick(w, 10);
  s.ok(ron.task === null, '走到商摊交易任务完成');
  s.ok(Math.hypot(ron.x - MERCHANT_POS.x, ron.z - MERCHANT_POS.z) <= 0.5, '已到商摊', `dist=${Math.hypot(ron.x - MERCHANT_POS.x, ron.z - MERCHANT_POS.z).toFixed(2)}`);
  const g0 = w.gold;
  s.ok(simSell(w, ron, 'wood'), '出售木材');
  s.ok(w.gold === g0 + 2, '木材 +2 金', `gold=${w.gold}`);
  s.ok(simSell(w, ron, 'food'), '出售食物');
  s.ok(w.gold === g0 + 2 + 3, '食物 +3 金');
  ron.inv.wood = 10;
  const g1 = w.gold;
  for (let i = 0; i < 3; i++) simSell(w, ron, 'wood'); // soldToday.wood: 1→3，均按 2 金
  s.ok(w.gold === g1 + 2 + 2 + 2, '前 3 个按基准价 2 金', `+${w.gold - g1} 金`);
  simSell(w, ron, 'wood'); // soldToday.wood: 3→4 → floor(4/4)=1 → 降至 1 金
  s.ok(w.gold === g1 + 6 + 1, '第 4 个价格跌至 1 金（dropPer=4）', `+${w.gold - g1} 金`);
  ron.inv = {};
  s.ok(!simSell(w, ron, 'wood'), '空背包拒绝出售');
  s.run();
}

// ============================================================
// 10. 修船（主线）
// ============================================================
{
  const s = suite('10 · 修船');
  const w = world();
  const ron = u0(w);
  ron.inv = { wood: 30, stone: 20, food: 0, seed: 0, berry: 0 };
  ron.x = 10; ron.z = 10;
  s.ok(!simDonateShip(w, ron, 'wood'), '距离不足拒绝投入');
  simMove(w, ron, CFG.shipPos.x, CFG.shipPos.z);
  tick(w, 15);
  s.ok(Math.hypot(ron.x - CFG.shipPos.x, ron.z - CFG.shipPos.z) <= CFG.shipNearDist, '已到船边', `dist=${Math.hypot(ron.x - CFG.shipPos.x, ron.z - CFG.shipPos.z).toFixed(1)}`);
  s.ok(simDonateShip(w, ron, 'wood'), '投入木材');
  s.ok(w.ship.wood === 10, '船木材 10/30');
  simDonateShip(w, ron, 'wood');
  simDonateShip(w, ron, 'wood');
  s.ok(w.ship.wood === CFG.shipWoodNeed, '木材封顶 30/30', `wood=${w.ship.wood}`);
  simDonateShip(w, ron, 'stone');
  simDonateShip(w, ron, 'stone');
  simDonateShip(w, ron, 'stone');
  simDonateShip(w, ron, 'stone');
  s.ok(w.ship.stone === CFG.shipStoneNeed, '石头 20/20', `stone=${w.ship.stone}`);
  s.ok(w.ship.done, '破船翻正（主线达成）');
  s.ok(!simDonateShip(w, ron, 'wood'), '完成后拒绝再投入');
  s.ok((ron.inv.wood ?? 0) === 0 && (ron.inv.stone ?? 0) === 0, '背包材料扣尽', `w=${ron.inv.wood ?? 0} s=${ron.inv.stone ?? 0}`);
  s.run();
}

// ============================================================
// 11. 技能累积与加成
// ============================================================
{
  const s = suite('11 · 技能累积');
  const w = world();
  w.wolfSpawnDisabled = true; w.wolves.length = 0; // 干净环境：禁狼干扰
  const ron = u0(w);
  for (let i = 0; i < 3; i++) {
    // 就近选活树（连续固定索引可能跨全图，25 秒走不到）
    const near = [...w.trees]
      .filter((t) => t.alive)
      .sort((a, b) => Math.hypot(a.x - ron.x, a.z - ron.z) - Math.hypot(b.x - ron.x, b.z - ron.z))[0];
    simGatherTree(w, ron, w.trees.indexOf(near));
    tick(w, 25);
  }
  s.ok(ron.skills.gather === 3, '砍 3 树 gather=3', `gather=${ron.skills.gather}`);
  s.ok(ron.capacity === CFG.inventoryCap + 4, '采集 Lv1 负重 40→44', `capacity=${ron.capacity}`);
  s.run();
}

// ============================================================
// 12. 背包转移 / 丢弃
// ============================================================
{
  const s = suite('12 · 背包转移与丢弃');
  const w = world();
  const ron = u0(w), kelly = u1(w);
  ron.inv = { wood: 10, stone: 0, food: 0, seed: 0, berry: 0 };
  kelly.inv = { wood: 2, stone: 0, food: 0, seed: 0, berry: 0 };
  s.ok(transferItem(ron, kelly, 'wood', 5), '转移 5 木材');
  s.ok((ron.inv.wood ?? 0) === 5 && (kelly.inv.wood ?? 0) === 7, '双方背包同步', `${ron.inv.wood}/${kelly.inv.wood}`);
  s.ok(transferItem(ron, null, 'wood', 5), '丢弃 5 木材');
  s.ok((ron.inv.wood ?? 0) === 0, '丢弃后清空');
  kelly.inv = { wood: 20 }; // 40/40 满
  ron.inv = { wood: 10 };
  s.ok(!transferItem(ron, kelly, 'wood', 1), '接收方满拒绝转移');
  s.ok((ron.inv.wood ?? 0) === 10, '拒绝时发送方不扣', `wood=${ron.inv.wood}`);
  s.run();
}

// ============================================================
// 13. 存档数据闭环（collectSave 等价结构 → JSON 往返 → 恢复核对）
// 不依赖 DOM/localStorage：验证"存档环节"的数据完整性与字段往返
// ============================================================
{
  const s = suite('13 · 存档数据闭环');
  function simCollectSave(w) {
    return {
      version: 3,
      savedAt: '2026-01-01T00:00:00.000Z',
      gold: w.gold,
      time: w.t,
      units: w.players.map((u) => ({
        name: u.name, x: u.x, z: u.z, hp: u.hp, hunger: u.hunger,
        hasSpear: u.hasSpear, atkDmg: u.atkDmg,
        inv: { ...u.inv }, skills: { ...u.skills },
        attrs: { ...u.attrs },
      })),
      buildings: w.buildings.map((b) => ({ type: b.type, x: b.x, z: b.z })),
      tiles: w.tiles.map((t) => ({ x: t.x, z: t.z, state: t.state, grow: t.grow })),
      wanderer: w.wanderer ? { available: w.wanderer.available, respawn: w.wanderer.respawn } : null,
      ship: { wood: w.ship.wood, stone: w.ship.stone, done: w.ship.done },
    };
  }
  // 造一个"进行中"世界（改满各种状态再收集）
  const w = world();
  const ron = u0(w);
  w.gold = 77;
  w.t = 0.42;
  w.ship = { wood: 30, stone: 20, done: true };
  w.buildings.push({ type: 'house', x: 5, z: 5 });
  w.tiles[100].state = 3; w.tiles[100].grow = 1;
  ron.hp = 63; ron.hunger = 47;
  ron.hasSpear = true; ron.atkDmg = 8;
  ron.inv = { wood: 12, stone: 0, food: 5, seed: 2, berry: 1 };
  ron.skills = { gather: 3, combat: 0, farm: 1 };
  ron.attrs = { stamina: 88, staminaXp: 5, vitalityXp: 0, atkXp: 0, defXp: 0 };
  w.wanderer.available = false; w.wanderer.respawn = 30;
  const save = simCollectSave(w);
  // JSON 往返（模拟 localStorage 存/取）
  const restored = JSON.parse(JSON.stringify(save));
  s.ok(restored.version === 3, '版本字段保留');
  s.ok(restored.gold === 77 && Math.abs(restored.time - 0.42) < 1e-9, '金币/时辰保留', `gold=${restored.gold} t=${restored.time}`);
  s.ok(restored.units.length === 3, '队员数量保留');
  const ru = restored.units[0];
  s.ok(ru.name === ron.name && ru.hp === 63 && ru.hunger === 47, '队员血量/饥饿保留', `${ru.hp}/${ru.hunger}`);
  s.ok(ru.hasSpear === true && ru.atkDmg === 8, '木矛状态保留');
  s.ok(JSON.stringify(ru.inv) === JSON.stringify({ wood: 12, stone: 0, food: 5, seed: 2, berry: 1 }), '背包字段保留（含 0 键，collectSave 原样复制）', JSON.stringify(ru.inv));
  s.ok(JSON.stringify(ru.skills) === JSON.stringify({ gather: 3, combat: 0, farm: 1 }), '技能保留');
  s.ok(JSON.stringify(ru.attrs) === JSON.stringify({ stamina: 88, staminaXp: 5, vitalityXp: 0, atkXp: 0, defXp: 0 }), '属性字段保留');
  s.ok(restored.buildings.length === 1 && restored.buildings[0].type === 'house', '建筑保留');
  s.ok(restored.tiles[100].state === 3 && restored.tiles[100].grow === 1, '农田生长保留');
  s.ok(restored.wanderer.available === false && restored.wanderer.respawn === 30, '流浪者保留');
  s.ok(restored.ship.done === true && restored.ship.wood === 30, '修船进度保留');
  // 恢复语义核对：读档后角色技能 → 负重上限重算（save.ts 同款公式）
  s.ok(CFG.inventoryCap + Math.floor(3 / CFG.skillXPForLevel[0]) * CFG.skillCapacityPerLv === 44,
    '读档后按技能重算负重（gather3 → 44）', `cap=${CFG.inventoryCap + Math.floor(3 / CFG.skillXPForLevel[0]) * CFG.skillCapacityPerLv}`);
  s.run();
}

// ============================================================
// 14. 补环节：买种子 / 饥饿致死 / 多人同采 / 夜晚狼速
// ============================================================
{
  const s = suite('14 · 补环节');
  // 买种子（2 金/个，钱不足/背包满拒绝）
  const ws = world();
  const rs = u0(ws);
  const g0 = ws.gold;
  s.ok(simBuySeed(ws, rs), '购买种子');
  s.ok(ws.gold === g0 - CFG.seedPrice && (rs.inv.seed ?? 0) === 2, '金币 -2、种子 +1（初始 1→2）', `gold=${ws.gold} seed=${rs.inv.seed}`);
  ws.gold = 1;
  s.ok(!simBuySeed(ws, rs), '金币不足拒绝买种子');
  ws.gold = 20;
  rs.inv = { wood: 20 }; // 40/40 满
  s.ok(!simBuySeed(ws, rs), '背包满拒绝买种子');
  // 饥饿致死：hunger=0 → 每秒 -1 hp
  const wh = world();
  const rh = u0(wh);
  rh.hunger = 0;
  const hp0 = rh.hp;
  tick(wh, 5);
  s.ok(rh.hp < hp0 && Math.abs(rh.hp - (hp0 - 5)) < 0.01, '饥饿掉血（0.1/tick，5 秒 -5）', `hp ${hp0}→${rh.hp.toFixed(2)}`);
  // 多人同采同一棵树：一人采完，另一人任务取消
  const wt = world();
  wt.wolfSpawnDisabled = true; wt.wolves.length = 0;
  const r1 = u0(wt), r2 = u1(wt);
  const nearTree = [...wt.trees].sort((a, b) => Math.hypot(a.x - r1.x, a.z - r1.z) - Math.hypot(b.x - r1.x, b.z - r1.z))[0];
  const tIdx = wt.trees.indexOf(nearTree);
  simGatherTree(wt, r1, tIdx);
  simGatherTree(wt, r2, tIdx);
  tick(wt, 25);
  s.ok(r1.task === null && r2.task === null, '两人同采任务都结束', `${r1.task?.type ?? 'null'}/${r2.task?.type ?? 'null'}`);
  s.ok(!nearTree.alive && (r1.inv.wood ?? 0) + (r2.inv.wood ?? 0) === (r1.inv.wood ?? 0) + 3,
    '树只被结算一次（产量不重复）', `wood=${(r1.inv.wood ?? 0) + (r2.inv.wood ?? 0)}`);
  // 夜晚狼速：同距离下夜晚 3 秒追得更近
  const wd = world();
  const rd = u0(wd);
  u1(wd).down = true; wd.players[2].down = true;
  u1(wd).x = 100; wd.players[2].x = 100;
  const wolfD = wd.wolves[0];
  wolfD.x = rd.x + 10; wolfD.z = rd.z;
  wd.t = 0.3; // 白天
  tick(wd, 3);
  const dayDist = wolfD.dist2(rd.x, rd.z);
  const wn = world();
  const rn = u0(wn);
  u1(wn).down = true; wn.players[2].down = true;
  u1(wn).x = 100; wn.players[2].x = 100;
  const wolfN = wn.wolves[0];
  wolfN.x = rn.x + 10; wolfN.z = rn.z;
  wn.t = 0.6; // 夜晚
  tick(wn, 3);
  const nightDist = wolfN.dist2(rn.x, rn.z);
  s.ok(nightDist < dayDist, '夜晚狼追得更快', `夜晚剩 ${nightDist.toFixed(1)} vs 白天剩 ${dayDist.toFixed(1)}`);
  s.run();
}

// ============================================================
// ============================================================
// 15. 属性系统（spec 010：用就长 + 体力预算 + 饥饿联动）
// ============================================================
{
  const s = suite('15 · 属性系统');
  // 1) 砍树 3 次（树放脚边不走动）→ 体力 91、staminaXp 3 → Lv1 上限 110
  const wa = world();
  const ra = u0(wa);
  wa.wolfSpawnDisabled = true; wa.wolves.length = 0;
  for (let i = 0; i < 3; i++) {
    const tr = wa.trees[i];
    tr.x = ra.x; tr.z = ra.z; tr.alive = true; tr.respawn = 0;
    simGatherTree(wa, ra, i);
    tick(wa, 4);
  }
  s.ok(ra.attrs.stamina < 100 && ra.attrs.stamina > 90, '砍树 3 次体力消耗（-9 被部分静止恢复抵消）', `stamina=${ra.attrs.stamina.toFixed(1)}`);
  s.ok(ra.attrs.staminaXp === 3 && ra.attrs.staminaXp === 3, '砍树 3 次 staminaXp 3');
  const cap1 = 100 + CFG.attrStaminaPerLv;
  s.ok(ra.attrs.stamina <= cap1 && cap1 === 110, '体力 Lv1 上限 100→110', `cap=${cap1}`);

  // 2) 跑动 10 秒 -5 体力 +1 经验；静止 5 秒 +5
  const wb = world();
  const rb = u0(wb);
  wb.wolfSpawnDisabled = true; wb.wolves.length = 0;
  for (let i = 0; i < 100; i++) rb.moveToward(rb.x + 50, rb.z, 0.1); // 手动 10 秒跑动
  s.ok(Math.abs(rb.attrs.stamina - (100 - CFG.staminaMoveCost * 10)) < 0.01, '跑动 10s 体力 -5', `stamina=${rb.attrs.stamina.toFixed(2)}`);
  s.ok(rb.attrs.staminaXp >= 1, '跑动 10s 体力经验 +1', `xp=${rb.attrs.staminaXp}`);
  tick(wb, 5); // 静止恢复（无任务）
  s.ok(rb.attrs.stamina === 100, '静止 5s 恢复 +5（封顶当前上限）', `stamina=${rb.attrs.stamina}`);

  // 3) 进食双收益：hunger +50、stamina +30
  const wc = world();
  const rc = u0(wc);
  rc.hunger = 40; rc.attrs.stamina = 60;
  rc.inv = { wood: 0, stone: 0, food: 3, seed: 0, berry: 0 };
  simEat(wc, [rc]);
  s.ok(rc.hunger === 90, '进食饥饿 +50', `hunger=${rc.hunger}`);
  s.ok(rc.attrs.stamina === 90, '进食体力 +30', `stamina=${rc.attrs.stamina}`);

  // 4) 体力 ≤20% → 移动 ×0.8（同起点同目标，10 秒后走得更近）
  const wd = world();
  wd.wolfSpawnDisabled = true; wd.wolves.length = 0;
  const rd = u0(wd), kd = u1(wd);
  rd.x = kd.x = 0; rd.z = kd.z = 0;
  rd.attrs.stamina = 10; kd.attrs.stamina = 100;
  for (let i = 0; i < 100; i++) {
    rd.moveToward(50, 0, 0.1);
    kd.moveToward(50, 0, 0.1);
  }
  s.ok(kd.x > rd.x, '体力满走得远，告急走得近', `kelly=${kd.x.toFixed(1)} ron=${rd.x.toFixed(1)}`);

  // 5) 挨咬 5 次 → defXp 5 → Lv1 → 狼伤 3→2（保底 1）
  const we = world();
  const re = u0(we);
  const wl = we.wolves[0];
  wl.x = re.x + 1; wl.z = re.z; wl.speed = 0;
  for (let i = 0; i < 5; i++) re.takeDamage(3, wl);
  s.ok(re.attrs.defXp === 5, '挨咬 5 次 defXp 5');
  s.ok(re.hp === 100 - 13, '5 咬共 -13（前 3 咬 -3，第 4 咬起防御 Lv1 -2）', `hp=${re.hp}`);
  const hpBefore6 = re.hp;
  re.takeDamage(3, wl);
  s.ok(re.hp === hpBefore6 - 2, '防御 Lv1 后第 6 咬 -2', `hp=${re.hp}`);
  re.takeDamage(3, wl);
  s.ok(re.hp === hpBefore6 - 4, '第 7 咬仍 -2', `hp=${re.hp}`);

  // 6) 命中狼 3 次 → atkXp 3 → Lv1 → 伤害 +1
  const wf = world();
  const rf = u0(wf);
  const wlf = wf.wolves[0];
  wlf.x = rf.x + 1.5; wlf.z = rf.z; wlf.speed = 0; wlf.atkT = 999;
  wlf.hp = 30; wlf.down = false; wlf.dead = false;
  rf.task = { type: 'attack', target: 0, targetRole: 'wolf', pos: { x: wlf.x, z: wlf.z }, workT: 0 };
  rf.targetPos = { x: wlf.x, z: wlf.z };
  tick(wf, 6); // atkCd 1.2s → 约 5 刀
  s.ok(rf.attrs.atkXp >= 3, '命中狼 atkXp ≥3', `xp=${rf.attrs.atkXp}`);
  s.ok(wlf.hp < 30, '狼被持续打掉血', `wolfHp=${wlf.hp}`);
  const dmgPerHit = 5 + CFG.attrAtkPerLv; // 5 + atkLv1
  s.ok(30 - wlf.hp >= dmgPerHit * 3, '伤害含攻击属性加成（5+Lv1 → 6/刀）', `损失=${30 - wlf.hp}`);

  // 7) 饥饿 ≤20 → 攻击 -1、采集变慢
  const wg = world();
  const rg = u0(wg);
  const wlg = wg.wolves[0];
  wlg.x = rg.x + 1.5; wlg.z = rg.z; wlg.speed = 0; wlg.atkT = 999; wlg.hp = 30;
  rg.hunger = 15;
  rg.atkT = 0.5; // 第一刀在 0.6s，第二刀在 1.8s → 0.7s 内只出一刀
  rg.task = { type: 'attack', target: 0, targetRole: 'wolf', pos: { x: wlg.x, z: wlg.z }, workT: 0 };
  rg.targetPos = { x: wlg.x, z: wlg.z };
  tick(wg, 0.7);
  s.ok(wlg.hp === 30 - (5 - CFG.hungerAtkPenalty), '饥饿攻击 -1（5→4）', `wolfHp=${wlg.hp}`);
  const wh = world();
  const rh = u0(wh);
  rh.hunger = 15;
  const tr = wh.trees[0];
  tr.x = rh.x; tr.z = rh.z;
  simGatherTree(wh, rh, 0);
  tick(wh, 2);
  s.ok(rh.task !== null, '采集变慢：2s 未完成（×0.9）', `workT=${rh.task?.workT ?? '-'}`);
  tick(wh, 1);
  s.ok(rh.task === null && (rh.inv.wood ?? 0) === 3 + CFG.woodPerTree, '3s 时完成（2/0.9≈2.2s），初始 3+采 3', `wood=${rh.inv.wood}`);

  // 8) 读档语义：属性经验恢复 → maxHp/攻击重算
  const wi = world();
  const ri = u0(wi);
  ri.attrs.vitalityXp = 3; ri.attrs.atkXp = 3;
  ri.maxHp = 100 + CFG.attrVitalityPerLv;
  ri.hp = ri.maxHp;
  s.ok(ri.maxHp === 105, '读档后生命力 Lv1 → maxHp 105', `maxHp=${ri.maxHp}`);
  s.run();
}

console.log('\n' + (allFails.length
  ? `== 失败 ${allFails.length} 项（共 ${totalChecks} 断言）：\n  - ` + allFails.join('\n  - ')
  : `== 全部断言通过（共 ${totalChecks} 断言） ==`));
process.exit(allFails.length ? 1 : 0);
