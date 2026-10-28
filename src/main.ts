/**
 * Wilderlands · 游戏入口
 * 初始化世界、小队、UI 与输入，驱动主循环。
 */
import * as THREE from 'three';
import { CFG } from './config';
import { renderer, scene, camera, updateCamera, resize, updateCameraMove, cam } from './core/renderer';
import { buildBerries, buildGround, buildMerchant, buildRocks, buildTrees, buildWanderer } from './core/world';
import { buildShip, updateShip } from './entities/ship';
import { createPlayers, PioneerUnit } from './entities/unit';
import { berries, buildings, clearSavePending, getSavePending, gold, logMsg, merchantPos, players, rocks, selected, tiles, timeOfDay, trees, wanderer, wolves } from './state';
import { invTotal } from './systems/inventory';
import { skillOf } from './systems/skills';
import { buyPrice, soldToday } from './systems/trade';
import { ship } from './systems/ship';
import { disableWolves, spawnWolf, updateWolves, updateWorld } from './systems/combat';
import { updateDayNight } from './systems/daynight';
import { initFloaters, drainGainFx } from './ui/floaters';
import { tickDeathAnims } from './core/world';
import { updateFarms } from './systems/farm';
import { initInput, keys } from './core/input';
import { initHUD, updateHUD } from './ui/hud';
import { initTrade, openTrade } from './ui/trade';
import { initShipUI } from './ui/ship';
import { initSaveUI } from './ui/save';
import { applySave, initAutoSave, readSlot } from './systems/save';

// ===== 初始化世界 =====
buildGround();
buildTrees();
buildRocks();
buildBerries();
buildMerchant();
buildWanderer();

// ===== 小队与野狼：默认开局，或按待读存档恢复 =====
const pendingSlot = getSavePending();
if (pendingSlot) {
  const save = readSlot(pendingSlot);
  clearSavePending();
  if (save) {
    applySave(save); // 创建队员/恢复建筑/农田/金币/时辰/流浪者；树石浆果已重新生成
    for (let i = 0; i < 3; i++) spawnWolf(); // 野狼不存档，读档后重新刷新
    logMsg('已读档（' + pendingSlot + '），欢迎回来，拓荒者');
  } else {
    // 存档损坏/版本不符：回退新开局
    createPlayers();
    for (let i = 0; i < 3; i++) spawnWolf();
    logMsg('存档不可用，已开始新的一局');
  }
} else {
  createPlayers();
  for (let i = 0; i < 3; i++) spawnWolf();
}

// 破船在存档恢复后构建（读档时按已恢复的 ship.done 决定倒扣/翻正）
buildShip();

// 临时验证钩子：?anim=walk 让第一个角色自动走向远处（用于验证走路动画）
const params = new URLSearchParams(location.search);
// 调试钩子：?ship=1 镜头对准破船（找主线目标），并回到白天
if (params.get('ship') === '1') {
  cam.target.set(CFG.shipPos.x, 0, CFG.shipPos.z);
  timeOfDay.t = 0.12;
}
if (params.get('anim') === 'walk') {
  players[0].task = { type: 'move', pos: new THREE.Vector3(30, 0, 35), workT: 0 };
}

// ===== UI 与输入 =====
initHUD();
initTrade();
initShipUI();
initSaveUI();
initInput();
initAutoSave();
players.forEach((u) => {
  if (u instanceof PioneerUnit) u.setTradeCallback((me) => openTrade(me));
});

// ===== 主循环 =====
const clock = new THREE.Clock();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 时间倍率（仅测试/自检用）：?turbo=N 每帧跑 N 个固定 0.05s 逻辑子步（上限 16）。
// 玩家默认不带参数 → 1×，手感与平衡完全不变；headless 软渲染帧率低导致
// 逻辑被 dt 钳速拖慢时，用它快进游戏世界（只加速模拟，不加速相机/输入）。
const TURBO = Math.max(1, Math.min(16, Math.floor(Number(new URLSearchParams(location.search).get('turbo')) || 1)));

function stepGame(dt: number): void {
  updateDayNight(dt);
  tickDeathAnims(dt);
  drainGainFx();
  updateShip(dt);
  updateFarms(dt);
  updateWolves(dt);
  updateWorld(dt);
  players.forEach((u) => u.update(dt));
  wolves.forEach((w) => w.update(dt));
}

function loop(): void {
  requestAnimationFrame(loop);
  const real = Math.min(clock.getDelta(), 0.05);

  updateCameraMove(keys, real);
  if (TURBO === 1) stepGame(real);
  else for (let i = 0; i < TURBO; i++) stepGame(0.05);

  if (!reducedMotion) {
    players.forEach((u, i) => {
      if (u instanceof PioneerUnit) u.markerTick(real);
      if (!u.task && !u.down) {
        u.mesh.position.y = Math.abs(Math.sin(clock.elapsedTime + i)) * 0.03;
      }
    });
  }

  updateCamera();
  updateHUD(selected);
  renderer.render(scene, camera);
}

// 首帧立即渲染（reduced-motion / 自检场景也有一帧画面）
updateCamera();
renderer.render(scene, camera);
loop();

window.addEventListener('resize', resize);

// 场景就绪标记（自检用）
(window as unknown as { __GAME_READY: boolean }).__GAME_READY = true;

// ?nowolf=1 测试夹具：清场野狼并停止刷怪。URL 参数跨页面 reload 持续生效，
// 长流程自动化在 turbo 快进下不再被狼群放倒队员/刷屏日志（玩家路径不带参数，无影响）
if (new URLSearchParams(location.search).get('nowolf') === '1') disableWolves();

// 只读调试句柄（自动化验证 / 开发自检用，与 __GAME_READY 同模式）
initFloaters();
(window as unknown as { __GAME__: unknown }).__GAME__ = {
  get gold() {
    return gold;
  },
  get players() {
    return players.length;
  },
  get wolves() {
    return wolves.length;
  },
  get berries() {
    return berries.length;
  },
  get invs() {
    return players.map((u) => ({ name: u.name, inv: { ...u.inv }, load: invTotal(u.inv) }));
  },
  get wanderer() {
    return wanderer ? { name: wanderer.name, available: wanderer.available } : null;
  },
  get time() {
    return timeOfDay.t;
  },
  // —— 自动化验证扩展（只读，不改任何状态）：黑盒测试定位与断言用 ——
  get units() {
    return players.map((u) => ({
      name: u.name, x: u.pos.x, z: u.pos.z,
      hp: Math.ceil(u.hp), hunger: Math.ceil(u.hunger),
      stamina: Math.ceil(u.attrs?.stamina ?? CFG.staminaBase),
      down: u.down, selected: u.selected, capacity: u.capacity,
      task: u.task?.type ?? null,
    }));
  },
  get wolfList() {
    return wolves.map((w) => ({
      x: w.pos.x, z: w.pos.z, down: w.down,
      dead: (w as unknown as { dead?: boolean }).dead ?? false,
    }));
  },
  get targets() {
    return {
      trees: trees.filter((t) => t.alive).map((t) => ({ x: t.p.x, y: t.p.y, z: t.p.z })),
      rocks: rocks.filter((r) => r.alive).map((r) => ({ x: r.p.x, y: r.p.y, z: r.p.z })),
      berries: berries.filter((b) => b.alive).map((b) => ({ x: b.p.x, y: b.p.y, z: b.p.z })),
      merchant: { x: merchantPos.x, z: merchantPos.z },
      ship: { x: CFG.shipPos.x, z: CFG.shipPos.z, wood: ship.wood, stone: ship.stone, done: ship.done },
      wanderer: wanderer
        ? { x: wanderer.p.x, z: wanderer.p.z, available: wanderer.available, visible: wanderer.mesh.visible }
        : null,
    };
  },
  get buildings() {
    return buildings.length;
  },
  get tiles() {
    return tiles.filter((t) => t.state !== 0).map((t) => ({ x: t.x, z: t.z, state: t.state }));
  },
  /** 世界坐标 → 屏幕坐标（相机投影，黑盒测试定位 3D 目标用；height 取世界高度，默认 1） */
  proj(x: number, z: number, height = 1) {
    const v = new THREE.Vector3(x, height, z).project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      inFront: v.z < 1,
    };
  },
  /** 自动化验证夹具：运行时传送单位（不改存档、不重生成世界，黑盒测试缩短步行用） */
  setPos(i: number, x: number, z: number) {
    const u = players[i];
    if (!u) return;
    u.pos.x = x;
    u.pos.z = z;
    u.mesh.position.copy(u.pos);
  },
  /** 自动化验证夹具：运行时改写单位背包（黑盒测试构造边界场景用） */
  setInv(i: number, id: string, n: number) {
    const u = players[i];
    if (!u || !(id in u.inv)) return;
    (u.inv as Record<string, number>)[id] = n;
  },
  /** 自动化验证夹具：把相机目标移到指定世界坐标（黑盒测试视角对准用） */
  setCamTarget(x: number, z: number) {
    cam.target.set(x, 0, z);
  },
  /** 自动化验证夹具：现场生成一名新拓荒者（多选/转移等双人场景用，绕开招募条件门；空背包，语义同招募入队） */
  addPlayer(x: number, z: number, name?: string) {
    const u = new PioneerUnit('player', x, z, name);
    return players.length;
  },
  /** 自动化验证夹具：注入固定性格（黑盒确定性：同性格同行为，绕开随机三维度） */
  setPersonality(i: number, p: { combat: string; work: string; trait: string }) {
    const u = players[i];
    if (!u) return;
    u.personality = p as typeof u.personality;
  },
  /** 自动化验证夹具：清场野狼并停止刷怪（长流程组默认执行，防 turbo 快进下狼群刷屏日志/放倒队员；G14 战斗组不调用） */
  noWolves() {
    disableWolves();
  },
};

// 调试模式：?debug=1 时把运行时状态渲染进提示框（自动化验证用，与 ?anim=walk 同模式）
if (new URLSearchParams(location.search).get('debug') === '1') {
  const dbgEl = document.getElementById('hint');
  if (dbgEl) {
    dbgEl.style.display = 'block';
    dbgEl.style.fontSize = '11px';
    dbgEl.style.textAlign = 'left';
    setInterval(() => {
      const sq = { wood: 0, stone: 0, food: 0, seed: 0, berry: 0 };
      for (const u of players) {
        for (const k of Object.keys(sq) as (keyof typeof sq)[]) sq[k] += u.inv[k] ?? 0;
      }
      dbgEl.textContent =
        'dbg gold' + gold +
        ' wood' + sq.wood +
        ' stone' + sq.stone +
        ' food' + sq.food +
        ' seed' + sq.seed +
        ' berry' + sq.berry +
        ' | players' + players.length +
        ' wolves' + wolves.length +
        ' berries' + berries.length +
        ' | 背包 ' + players.map((u) => u.name + ':' + invTotal(u.inv) + '/' + u.capacity).join(' ') +
        ' | 技能 ' + players.map((u) => u.name + ' 采' + skillOf(u, 'gather') + ' 战' + skillOf(u, 'combat') + ' 田' + skillOf(u, 'farm')).join(' ') +
        ' | 价 ' + ['wood', 'stone', 'food'].map((k) => k[0] + buyPrice(k as 'wood' | 'stone' | 'food', soldToday[k as 'wood' | 'stone' | 'food'])).join(' ') +
        ' | 船 ' + ship.wood + '/' + CFG.shipWoodNeed + ' 石' + ship.stone + '/' + CFG.shipStoneNeed + (ship.done ? ' 已修好' : '') +
        ' | wanderer ' + (wanderer ? wanderer.name + '/' + (wanderer.available ? '可招募' : '已离开') : '无') +
        ' | t' + timeOfDay.t.toFixed(2);
    }, 800);
  }
}
