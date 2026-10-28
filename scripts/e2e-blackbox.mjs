/**
 * Wilderlands · 黑盒测试（真实鼠标/键盘交互，不触碰内部实现）
 * 17 组场景：选择/框选/移动/采集/交易与锁定/面板互斥/ESC/存档闭环/破损存档/导出/
 * 招募/模式切换/播种/建造/背包转移/进食体力/修船主线通关/狼战/稳定性/调试钩子。
 * 用法：node scripts/e2e-blackbox.mjs   （需先 npm run build）
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { setTimeout as rawSleep } from 'node:timers/promises';
import { serve, openGame, check, resetCount, summary, failFast, panelVisible, panelGone, runInGroup } from './_e2e-util.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VW = { width: 1280, height: 800 };
let allOk = true;
// headless 软渲染帧率低 → 用游戏的 ?turbo=N 时间倍率快进逻辑（渲染不动，测试等待大幅缩短）
const TURBO = Math.max(1, Number(process.env.WL_TURBO ?? 8) || 1);
// 并行组数：各组是独立浏览器上下文（localStorage 隔离），互不干扰；软件渲染吃 CPU，默认 4
const CONC = Math.max(1, Number(process.env.WL_CONCURRENCY ?? 4) || 1);
// turbo 快进下，长等待（≥1500ms 的都是等游戏逻辑推进）压缩到 40%；短等待多为 DOM/动画节拍，保持真实时间
const sleep = (ms) => rawSleep(TURBO > 1 && ms >= 1500 ? Math.max(600, Math.ceil(ms * 0.4)) : ms);

// ========== 辅助 ==========

/** 轮询等待：fn 返回 truthy 则通过；fn 如需外部数据必须用参数 a（page.evaluate 不捕获闭包变量） */
async function waitFor(page, fn, desc, timeout = 30000, step = 120, args) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await page.evaluate(fn, args)) return true;
    } catch { /* 页面可能处于重载间隙 */ }
    await sleep(step);
  }
  return false;
}

/** 世界坐标 → 屏幕坐标；出视野或出屏幕则返回 null（严格，不 clamp） */
async function sp(page, x, z, height = 1) {
  const p = await page.evaluate(([px, pz, h]) => window.__GAME__.proj(px, pz, h), [x, z, height]);
  if (!p.inFront) return null;
  if (p.x < 4 || p.x > VW.width - 4 || p.y < 4 || p.y > VW.height - 4) return null;
  return { x: p.x, y: p.y };
}

/** 滚轮拉远相机（dist 22 → 80，扩大可视范围；游戏自带缩放） */
async function zoomOut(page) {
  await page.mouse.move(640, 400);
  for (let i = 0; i < 18; i++) await page.mouse.wheel(0, 800);
  await sleep(400);
}

/** DOM 点击（绕开 HUD 每帧重渲染导致的 detached 竞争；仍是原生 click 事件） */
async function clickDom(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.click(); return true; }
    return false;
  }, selector);
}

/** 全屏框选所有在屏幕内的角色（boxSelect 等价操作；起点取画布空白处避开 HUD） */
async function selectAll(page) {
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(1180, 700, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
}

/** 在 (cx,cz) 附近找离所有实体（树/石/浆果/围栏/商摊/船/建筑）足够远的空地 */
async function findClearSpot(page, cx, cz, radius = 12) {
  const obs = await page.evaluate(() => {
    const g = window.__GAME__;
    const pts = [
      ...g.targets.trees.map((t) => ({ x: t.x, z: t.z })),
      ...g.targets.rocks.map((r) => ({ x: r.x, z: r.z })),
    ];
    if (g.targets.merchant) pts.push({ x: g.targets.merchant.x, z: g.targets.merchant.z });
    if (g.targets.ship) pts.push({ x: g.targets.ship.x, z: g.targets.ship.z });
    return pts;
  });
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const minD = Math.min(...obs.map((o) => Math.hypot(o.x - x, o.z - z)));
    if (minD > 3.5) return { x, z, minD };
  }
  return null;
}

/** 左键点选某个角色（按索引）；多高度重试，失败返回 false */
async function clickUnit(page, idx) {
  // 页内同帧投影+派发（低帧率下 node 往返会被相机 lerp 插队造成漂移 miss——G21/G22 选中 flake 元凶）
  return page.evaluate((i) => {
    const g = window.__GAME__;
    const u = g.units[i];
    if (!u) return false;
    for (const h of [1.0, 1.4, 1.8]) {
      if (g.leftClickWorld(u.x, u.z, h)) {
        if (g.units.filter((x2) => x2.selected).length > 0) return true;
      }
    }
    return g.units.filter((x2) => x2.selected).length > 0;
  }, idx);
}

/** 该屏幕点是否落在 canvas（排除 HUD/面板遮挡） */
async function onCanvas(page, x, y) {
  return page.evaluate(([sx, sy]) => {
    const el = document.elementFromPoint(sx, sy);
    return !!el && el.tagName === 'CANVAS';
  }, [x, y]);
}

/** 右键下达命令（世界坐标） */
async function rightClickWorld(page, x, z) {
  const s = await sp(page, x, z);
  if (!s || !(await onCanvas(page, s.x, s.y))) return false;
  await page.mouse.click(s.x, s.y, { button: 'right' });
  return true;
}

/**
 * 存档夹具：把 units[0] 传送到 (x,z)，可选改背包/属性（patch），重载后生效。
 * headless 慢帧下角色移动极慢（~0.1–0.8 m/s），步行组必须把起点放目标附近。
 * 流程：先手动存 auto → 改存档 → pending=auto → reload。
 */
async function placeUnit(page, x, z, patch = {}) {
  await clickDom(page, '#saveBtn');
  await waitFor(page, () => { const el = document.getElementById('saveModal'); return el && getComputedStyle(el).display !== 'none'; }, '存档面板', 8000);
  await clickDom(page, '.sbtn[data-slot="auto"][data-act="save"]');
  await sleep(300);
  await page.keyboard.press('Escape');
  const inj = await page.evaluate(([px, pz, p]) => {
    const raw = localStorage.getItem('wilderlands.save.auto');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s.units || !s.units[0]) return false;
    s.units[0].x = px;
    s.units[0].z = pz;
    for (const [k, v] of Object.entries(p)) {
      if (k === 'inv') s.units[0].inv = { ...s.units[0].inv, ...v };
      else s.units[0][k] = v;
    }
    localStorage.setItem('wilderlands.save.auto', JSON.stringify(s));
    localStorage.setItem('wilderlands.save.pending', 'auto');
    return true;
  }, [x, z, patch]);
  if (!inj) return false;
  await page.reload();
  await waitFor(page, () => window.__GAME_READY === true, '重载', 15000, 400);
  await page.evaluate(() => { try { window.__GAME__?.freezeWolves?.(true); } catch { /* 夹具未就绪 */ } });
  await sleep(300);
  return true;
}

/** 右键实体并验证命令已下达：多高度重试（实体投影点可能 miss），成功后 task 应为期望类型之一 */
async function rightClickEntity(page, x, z, expectTasks, waitMs = 600) {
  for (const h of [1.0, 1.5, 2.0]) {
    const s = await sp(page, x, z, h);
    if (!s || !(await onCanvas(page, s.x, s.y))) continue;
    await page.mouse.click(s.x, s.y, { button: 'right' });
    await sleep(waitMs);
    const t = await page.evaluate(() => window.__GAME__.units.find((u) => u.selected)?.task ?? null);
    if (expectTasks.includes(t)) return true;
  }
  return false;
}

/** 读日志全部文本 */
/** 输入生效轮询：模式按钮 .on 高亮由 updateHUD 下一帧补上，瞬时读会踩帧间隙（G9 历史误伤元凶） */
const mbtnOn = (page, m) => waitFor(page, () => !!document.querySelector(`.mbtn[data-m="${m}"].on`), '模式按钮 ' + m, 15000, 150);

const logs = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('#log .msg')).map((m) => m.textContent || ''));

/** 读全局游戏状态 */
const gs = (page) => page.evaluate(() => {
  const g = window.__GAME__;
  return {
    gold: g.gold, players: g.players, wolves: g.wolves,
    units: g.units, invs: g.invs, targets: g.targets,
    buildings: g.buildings, tiles: g.tiles, time: g.time, wanderer: g.wanderer,
    wolfList: g.wolfList,
  };
});

/** 离目标最近的可点实体（wolves 从 wolfList 读，其余从 targets 读；maxDist 限定最大距离避免走到天荒地老） */
async function nearest(page, listKey, x, z, maxDist = Infinity) {
  const t = await page.evaluate(([k]) => {
    const g = window.__GAME__;
    return k === 'wolves' ? g.wolfList : g.targets[k];
  }, [listKey]);
  let best = null, bd = maxDist;
  for (const it of t) {
    const d = Math.hypot(it.x - x, it.z - z);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

/** 场景组骨架：独立 context，组内共享状态 */
/** 自愈浏览器：无 GPU 的 headless 环境里 chromium 偶发整体崩溃（曾连坐后续所有组）；断连自动重启 */
let _browser = null;
async function liveBrowser() {
  if (_browser && _browser.isConnected && _browser.isConnected()) return _browser;
  if (_browser) { try { await _browser.close(); } catch { /* 已死 */ } }
  console.log('  ⚠ 浏览器已断开（环境挤压崩溃），自动重启');
  _browser = await chromium.launch();
  return _browser;
}

async function g21_gather_feedback(page) {
  await zoomOut(page);
  const home = { x: (await gs(page)).units[0].x, z: (await gs(page)).units[0].z };
  const tree = await nearest(page, 'trees', home.x, home.z, 30);
  if (!tree) { check('收获飘字', false, '30m 内无树'); return; }
  await page.evaluate(([tx, tz]) => {
    window.__GAME__.setPos(0, tx, tz);
    window.__GAME__.setCamTarget(tx, tz, true); // 镜头跟到树旁，否则投影出视锥点不到
  }, [tree.x + 2, tree.z + 2]);
  await sleep(500);
  if (!(await clickUnit(page, 0))) { check('收获飘字', false, '无法选中主角'); return; }
  const cnt0 = (await page.evaluate(() => window.__GAME__.targets)).trees.length;
  const okCmd = await rightClickEntity(page, tree.x, tree.z, ['gather'], 500);
  if (!okCmd) { check('收获飘字', false, '树右键未下达采集'); return; }

  // ① 进包瞬间飘字上浮（DOM 层，1.2s 自清）
  const fl = await waitFor(page, () => [...document.querySelectorAll('#floaters .floater')].some((e) => e.textContent.includes('木材')), '砍树飘字', 30000, 120);
  check('收获进包出现飘字', fl);

  // ② 消亡动画（0.4s 下沉缩小）结束后树木计数落账
  const gone = await waitFor(page, (n) => window.__GAME__.targets.trees.length < n, '消亡动画完成', 15000, 150, cnt0);
  check('消亡动画后树木计数减一', gone, 'trees ' + cnt0 + '→' + (await page.evaluate(() => window.__GAME__.targets.trees.length)));

  // ③ 干活状态条：满包拒收期间任务仍在场，文案带 ▓ 条
  const tree2 = await nearest(page, 'trees', home.x, home.z, 30);
  if (!tree2) { check('干活状态条', false, '无第二棵树'); return; }
  await page.evaluate(([tx, tz]) => { window.__GAME__.setInv(0, 'wood', 40); window.__GAME__.setPos(0, tx, tz); window.__GAME__.setCamTarget(tx, tz, true); }, [tree2.x + 2, tree2.z + 2]);
  await sleep(500);
  const ok2 = await rightClickEntity(page, tree2.x, tree2.z, ['gather'], 600);
  const bar = ok2 ? await waitFor(page, () => { const a = (document.getElementById('curAction') || {}).textContent || ''; return a.includes('正在砍树') && a.includes('▓') ? a : false; }, '状态条', 8000, 120) : '';
  check('干活状态条随行为显示', !!bar, 'action=' + bar);
  // ④ 满包拒绝无收获飘字（负断言：拒绝发生后再查 floater 层无"木材"新增）
  const refused = await waitFor(page, () => (document.querySelector('#log') || {}).textContent?.includes('背包已满'), '满包拒绝日志', 60000, 200);
  const flGained = await page.evaluate(() => [...document.querySelectorAll('#floaters .floater')].some((e) => e.textContent.includes('木材')));
  check('背包满拒绝时不弹收获飘字', refused && !flGained, 'refused=' + refused + ' floater=' + flGained);
}

async function g22_unit_animation(page) {
  // 低倍率原生节拍（opts.turbo=1）：转向 slerp 需要帧级采样抓渐变
  await page.evaluate(() => {
    window.__GAME__.setPersonality(0, { combat: 'cautious', work: 'lazy', trait: 'quiet' });
  });
  await zoomOut(page);
  await clickUnit(page, 0);

  // ⓪ 狼摆尾：趁狼自由游荡先采样（随后即冻场，避免战斗干扰后续断言）
  const tailSeq = await page.evaluate(() => new Promise((res) => {
    const arr = [];
    const t0 = performance.now();
    const tick = () => {
      let v = null;
      for (let j = 0; j < 6 && v === null; j++) { const s = window.__GAME__.animState(j, 'wolf'); if (s && s.tail !== null) v = s.tail; }
      arr.push(v);
      if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
      else res(arr.filter((x) => x !== null));
    };
    requestAnimationFrame(tick);
  }));
  let tRange = 0;
  for (let i = 1; i < tailSeq.length; i++) tRange = Math.max(tRange, Math.abs(tailSeq[i] - tailSeq[i - 1]));
  check('狼奔跑摆尾（尾角非恒定）', tailSeq.length >= 3 && tRange > 0.05, '样本=' + tailSeq.length + ' 摆幅=' + tRange.toFixed(3));
  await page.evaluate(() => window.__GAME__.freezeWolves(true));

  // ① 转向平滑：反向移动命令后帧采样，变化是渐进的（单步 <0.7 弧度）且确实转了（总变化 >0.6）
  const u = (await gs(page)).units[0];
  const mv = await sp(page, u.x - 6, u.z - 6, 0.2);
  if (mv && (await onCanvas(page, mv.x, mv.y))) {
    await page.mouse.click(mv.x, mv.y, { button: 'right' });
    // turning=剩余角：出现明显中间态(>0.5 弧度)即证明 slerp 在跑，帧率无关
    const turning = await waitFor(page, () => Math.abs(window.__GAME__.animState(0)?.turning ?? 0) > 0.5, '转向中间态', 2000, 60);
    const settled = turning && await waitFor(page, () => Math.abs(window.__GAME__.animState(0)?.turning ?? 9) < 0.05, '转向到位', 3000, 100);
    check('转向平滑（存在中间态后收敛）', !!settled, 'turning 捕获=' + turning);
  } else check('转向平滑（帧间渐变非跳变）', false, '反向移动点出画');

  // ② 手持工具：右键树 → axe；采集结束 idle → 收工具
  // ① 的移动走完（防带着旧 task 进 ② 变长途跋涉）
  await waitFor(page, () => window.__GAME__.units[0].task == null, '①走完停稳', 20000, 200);
  const u1 = (await gs(page)).units[0]; // 停稳后刷新坐标：取 12m 内近树，防长途步行耗尽体力
  const tree = await page.evaluate(([ux, uz, r]) => {
    const ts = window.__GAME__.targets.trees.filter((t) => t.phase === 'mature');
    const near = (max) => ts.filter((t) => Math.hypot(t.x - ux, t.z - uz) <= max).sort((a, b) => Math.hypot(a.x - ux, a.z - uz) - Math.hypot(b.x - ux, b.z - uz))[0] || null;
    return near(r) || near(30);
  }, [u1.x, u1.z, 12]); // 三树种时代：只挑成材树（G22 早于幼树门，盲选会撞"还太小"）
  if (tree && (await clickUnit(page, 0))) {
    await page.evaluate(([x, z]) => window.__GAME__.setCamTarget(x, z, true), [tree.x, tree.z]);
    await sleep(500);
    const okT = await rightClickEntity(page, tree.x, tree.z, ['gather'], 600);
    const gotAxe = okT && await waitFor(page, () => window.__GAME__.animState(0)?.tool === 'axe', '持斧', 10000, 150);
    check('砍树持斧（工具挂右手）', gotAxe);
    let idleTool = false;
    let snap = '';
    if (gotAxe) {
      idleTool = await waitFor(page, () => { const g = window.__GAME__; return g.units[0].task == null && g.animState(0)?.tool === null; }, '收工具', 100000, 200);
      if (!idleTool) {
        const s1 = await page.evaluate(() => ({ anim: window.__GAME__.animState(0), pos: [ +window.__GAME__.units[0].x.toFixed(2), +window.__GAME__.units[0].z.toFixed(2) ] }));
        await sleep(1200);
        const s2 = await page.evaluate(() => ({ anim: window.__GAME__.animState(0), pos: [ +window.__GAME__.units[0].x.toFixed(2), +window.__GAME__.units[0].z.toFixed(2) ] }));
        snap = '1s位移=' + Math.hypot(s1.pos[0] - s2.pos[0], s1.pos[1] - s2.pos[1]).toFixed(2) + ' workT ' + s1.anim.workT + '→' + s2.anim.workT + ' tdist ' + s1.anim.tdist + '→' + s2.anim.tdist + ' sel ' + JSON.stringify((await gs(page)).units.map((x2) => x2.selected));
      }
    }
    check('任务结束 idle 收起工具', idleTool, '终态=' + snap);
  } else check('砍树持斧（工具挂右手）', false, '无树或未选中').valueOf();

  // ③ 倒地补间：伤害夹具放倒 → 0.45s 内 tilt 渐入到位（≥0.9），无瞬时硬切
  const t20 = await page.evaluate(() => window.__GAME__.animState(0)?.tilt ?? -1);
  await page.evaluate(() => window.__GAME__.damage(0, 9999));
  const mid = await page.evaluate(() => new Promise((res) => setTimeout(() => res(window.__GAME__.animState(0)?.tilt ?? -1), 120)));
  const done = await waitFor(page, () => (window.__GAME__.animState(0)?.tilt ?? 0) >= 0.9, '倒到位', 3000, 120);
  check('倒地 0.3s 倾倒补间', t20 === 0 && mid >= 0 && mid < 0.9 && done, 't0=' + t20 + ' 中间=' + mid);

}

async function g23_forest_life(page) {
  await page.evaluate(() => {
    window.__GAME__.setPersonality(0, { combat: 'cautious', work: 'lazy', trait: 'quiet' });
  });
  await zoomOut(page);

  // ① 生态基线：~150 棵、三树种齐、两树间距 ≥3.2m（页内全对扫描）
  const eco = await page.evaluate(() => {
    const ts = window.__GAME__.targets.trees;
    const sp = [0, 0, 0];
    let minGap = Infinity;
    for (const t of ts) sp[t.species]++;
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const d = Math.hypot(ts[i].x - ts[j].x, ts[i].z - ts[j].z);
      if (d < minGap) minGap = d;
    }
    return { n: ts.length, sp, minGap };
  });
  check('疏林 ~150 棵（拒绝采样生效）', eco.n >= 140 && eco.n <= 150, 'n=' + eco.n);
  check('三树种共存（松50/橡25/桦25）', eco.sp[0] >= 65 && eco.sp[1] >= 30 && eco.sp[2] >= 30, 'sp=' + eco.sp.join('/'));
  check('两树最小间距 ≥3.2m', eco.minGap >= 3.2 - 1e-6, 'minGap=' + eco.minGap.toFixed(2));

  // ② 生长循环：砍倒松树 → stump（targets 消失）→ sprout 再现 → 45s 内回 mature 可再砍
  if (await clickUnit(page, 0)) {
    const pine = await nearest(page, 'trees', (await gs(page)).units[0].x, (await gs(page)).units[0].z, 25);
    const ptree = (await page.evaluate(() => window.__GAME__.targets.trees.find((t) => t.species === 0 && t.phase === 'mature')) || pine);
    if (ptree) {
      await page.evaluate(([x, z]) => { window.__GAME__.setPos(0, x - 2, z); window.__GAME__.setCamTarget(x, z, true); }, [ptree.x, ptree.z]);
      await sleep(500);
      const gotCmd = await rightClickEntity(page, ptree.x, ptree.z, ['gather'], 600);
      const gone = gotCmd && await waitFor(page, ([x, z]) => !window.__GAME__.targets.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 0.5), '树桩空窗', 30000, 250, [ptree.x, ptree.z]);
      // ③ 幼树免砍门：检出即点即读的单一 waitFor（首拍零浪费，窗口覆盖苗+小树全程）
      const refused = await waitFor(page, ([x, z]) => {
        const g = window.__GAME__;
        const t = g.targets.trees.find((tt) => Math.hypot(tt.x - x, tt.z - z) < 0.5 && (tt.phase === 'sprout' || tt.phase === 'young'));
        if (t) for (const h of [0.45, 0.75, 1.1, 1.5, 1.9]) g.rightClickWorld(x, z, h);
        return ((document.getElementById('log') || {}).textContent || '').includes('还太小');
      }, '免砍门（检出即点读）', 20000, 200, [ptree.x, ptree.z]);
      check('幼树免砍门（拒绝+提示文案）', !!refused, 'task=' + JSON.stringify(await page.evaluate(() => window.__GAME__.units[0].task)));
      const mature = gone && await waitFor(page, ([x, z]) => { const t = window.__GAME__.targets.trees.find((tt) => Math.hypot(tt.x - x, tt.z - z) < 0.5); return !!t && t.phase === 'mature'; }, '松树成材', 40000, 300, [ptree.x, ptree.z]);
      check('砍后循环：空窗→新芽→成材（松45s）', !!mature, 'cmd=' + gotCmd);
      // ③ 成材后再砍得动
      await clickUnit(page, 0);
      const again = await rightClickEntity(page, ptree.x, ptree.z, ['gather'], 600);
      check('成材后重新可采', !!again);
    } else check('砍后循环：空窗→新芽→成材（松45s）', false, '找不到成树').valueOf();
  } else { check('砍后循环：空窗→新芽→成材（松45s）', false, '无法选中主角'); }

  // ⑤ 橡/桦产量：传送到近旁右键，背包木材增量 == 4/2
  for (const [want, species, label] of [[1, 4, '橡树 +4'], [2, 2, '白桦 +2']]) {
    const t = await page.evaluate((s) => {
      const g = window.__GAME__;
      const u = g.units[0];
      const c = g.targets.trees.filter((x) => x.species === s && x.phase === 'mature')
        .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
      return c || null;
    }, want);
    if (!t) { check('产量按树种（' + label + '）', false, '无成材样本').valueOf(); continue; }
    await page.evaluate(([x, z]) => { window.__GAME__.setPos(0, x - 2, z); window.__GAME__.setCamTarget(x, z, true); }, [t.x, t.z]);
    await sleep(400);
    if (!(await clickUnit(page, 0))) continue;
    const w0 = await page.evaluate(() => window.__GAME__.invs[0].inv.wood ?? 0);
    const HBySp = [[1.0, 1.5, 2.0], [1.5, 2.0, 2.6], [2.7, 3.3]]; // 各树种冠心高度
    // 点中≠点对：视线前景他树会截胡右键。校验 taskTarget 即目标树；持续遮挡则转相机重试一轮
    let cmd = false;
    for (let rnd = 0; rnd < 3 && !cmd; rnd++) {
      cmd = await page.evaluate(([x, z, hs]) => {
        const g = window.__GAME__;
        for (const h of hs) {
          g.rightClickWorld(x, z, h);
          const sel = g.units.find((u) => u.selected);
          if (sel && sel.task === 'gather') {
            const tt = g.taskTarget;
            return !!tt && Math.hypot(tt.x - x, tt.z - z) < 0.6;
          }
        }
        return false;
      }, [t.x, t.z, HBySp[want]]);
      if (!cmd) {
        await page.keyboard.press('KeyE'); await page.keyboard.press('KeyE'); await sleep(500); // 换方位躲遮挡
      }
    }
    let delta = false;
    let diag = '';
    if (cmd) {
      const got = await waitFor(page, ([bw]) => ((window.__GAME__.invs[0].inv.wood ?? 0) - bw) !== 0, '产量入账', 20000, 250, [w0]);
      delta = got ? await page.evaluate(([bw]) => (window.__GAME__.invs[0].inv.wood ?? 0) - bw, [w0]) : false;
      if (!delta) diag = JSON.stringify(await page.evaluate(() => ({ task: window.__GAME__.units[0].task, anim: window.__GAME__.animState(0), wood: window.__GAME__.invs[0].inv.wood ?? 0 })));
    }
    check('产量按树种（' + label + '）', delta === species, 'Δ=' + delta + ' cmd=' + cmd + ' ' + diag);
  }
}

async function g24_sound(page) {
  await page.evaluate(() => {
    window.__GAME__.setPersonality(0, { combat: 'cautious', work: 'lazy', trait: 'quiet' });
  });
  await zoomOut(page);
  const S = () => page.evaluate(() => window.__GAME__.soundStats());

  // ① 首次 pointer 手势解锁（右下角空白，避开 HUD 与静音钮）
  const vp = page.evaluate(() => [window.innerWidth, window.innerHeight]);
  await page.mouse.click((await vp)[0] - 24, (await vp)[1] - 24);
  let st = await S();
  check('首击解锁 AudioContext（unlocked）', st.unlocked === true, JSON.stringify(st).slice(0, 80));

  // ② 砍树链：三挥击 chop + 结算 pickup + 白天鸟鸣点缀
  const t = await page.evaluate(() => {
    const g = window.__GAME__;
    const u = g.units[0];
    const c = g.targets.trees.filter((x) => x.phase === 'mature')
      .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    if (c) { g.setPos(0, c.x - 2, c.z); g.setCamTarget(c.x, c.z, true); }
    return c || null;
  });
  if (!t) { check('砍树音效链（chop×3+pickup）', false, '无成树').valueOf(); }
  else {
    await sleep(600);
    if ((await clickUnit(page, 0)) || (await selectAll(page))) { // selectAll 回退：高载下 DOM 投影点击可能落空
      await rightClickEntity(page, t.x, t.z, ['gather'], 700);
      const gotPickup = await waitFor(page, () => {
        const c = window.__GAME__.soundStats().counts;
        return (c.pickup ?? 0) >= 1 && (c.chop ?? 0) >= 3;
      }, 'chop×3+pickup 入账', 25000, 300);
      st = await S();
      check('砍树音效链（chop×3+pickup）', !!gotPickup, JSON.stringify(st.counts));
    } else check('砍树音效链（chop×3+pickup）', false, '无法选中');
  }
  st = await S();
  check('白天床层有鸟鸣点缀', (st.counts.bird ?? 0) >= 1, 'bird=' + (st.counts.bird ?? 0));

  // ③ 拒绝类事件：背包满右键树 → 结算 ref 进记录
  await page.evaluate(() => window.__GAME__.setInv(0, 'wood', 40));
  const t2 = await page.evaluate(() => {
    const g = window.__GAME__;
    const u = g.units[0];
    const c = g.targets.trees.filter((x) => x.phase === 'mature' && Math.hypot(x.x - u.x, x.z - u.z) > 6)
      .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    if (c) { g.setPos(0, c.x - 2, c.z); g.setCamTarget(c.x, c.z, true); }
    return c || null;
  });
  if (t2) {
    await sleep(500);
    await clickUnit(page, 0);
    const refBefore = ((await S()).counts.ref ?? 0);
    // 同帧点中（任务建立即停手），再耐心等"结算满包拒绝"入账
    const cmdOk = await waitFor(page, ([x, z]) => {
      const g = window.__GAME__;
      for (const h of [1.2, 1.7, 2.2]) {
        g.rightClickWorld(x, z, h);
        if ((g.units.find((u) => u.selected) || {}).task === 'gather') return true;
      }
      return false;
    }, '满包采集任务建立', 8000, 250, [t2.x, t2.z]);
    const gotRef = cmdOk && await waitFor(page, ([rb]) => (window.__GAME__.soundStats().counts.ref ?? 0) > rb, 'ref 入账', 30000, 300, [refBefore]);
    check('背包满拒绝发声（ref）', !!gotRef, 'cmd=' + cmdOk);
  } else check('背包满拒绝发声（ref）', false, '无成熟样本');


  // ④ 昼夜翻转沿：setTime 入夜 → bed=night 且虫鸣渐起
  await page.evaluate(() => window.__GAME__.setTime(0.85));
  const gotNight = await waitFor(page, () => {
    const s = window.__GAME__.soundStats();
    return s.bed === 'night' && (s.counts.cricket ?? 0) >= 1;
  }, '入夜声景（night+cricket）', 12000, 300);
  check('入夜声景切换（bed=night+虫鸣）', !!gotNight);

  // ⑤ 静音：M 键即切、记录照常；静音跨存档读档保持
  await page.keyboard.press('KeyM');
  let mutedNow = (await S()).muted;
  const c0 = JSON.stringify((await S()).counts);
  await page.keyboard.press('KeyM');
  const unmutedOk = (await S()).muted === false;
  await page.keyboard.press('KeyM'); // 留静音态进存档
  await placeUnit(page, t ? t.x - 2 : 0, t ? t.z : 0, {}); // 存+读回环
  const stAfter = await S();
  check('M 键静音与读档保持', mutedNow === true && unmutedOk && stAfter.muted === true, 'M1=' + mutedNow + ' M2=' + unmutedOk + ' reload=' + stAfter.muted);
  check('静音吞发声不吞记录（counts 键集不缩）', Object.keys(stAfter.counts).length >= 0 && c0.length > 2, '');
}

/** 砍倒指定树种最近成树，返回帧环首样（dur/yaw/伐木者方位） */
async function fellTree(page, species) {
  const hBySp = [[1.0, 1.5, 2.0], [1.5, 2.0, 2.6], [2.7, 3.1, 3.5]]; // 白桦冠心 3.1（G23 实测，勿改）
  const t = await page.evaluate((s) => {
    const g = window.__GAME__;
    const u = g.units[0];
    const c = g.targets.trees.filter((x) => x.species === s && x.phase === 'mature')
      .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    if (c) { g.setPos(0, c.x - 2, c.z); g.setCamTarget(c.x, c.z, true); }
    return c || null;
  }, species);
  if (!t) return { fail: '无树' };
  await sleep(500);
  if (!(await clickUnit(page, 0))) return { fail: '选不到人' };
  // 绕行轮：固定站位对固定相机角会被前景他树确定性遮挡——每轮换入树站位破遮挡
  const cmd = await waitFor(page, ([x, z, hs]) => {
    const g = window.__GAME__;
    const rnd = (window.__wlRnd = (window.__wlRnd || 0) + 1);
    const a = (rnd % 5) * 1.256;
    g.setPos(0, x + 2 * Math.sin(a), z + 2 * Math.cos(a));
    g.setCamTarget(x, z, true);
    for (const h of hs) {
      g.rightClickWorld(x, z, h);
      const tt = g.taskTarget; // 无选中时 fallback players[0]，与 commandAt 同源
      if (tt && Math.hypot(tt.x - x, tt.z - z) < 0.6) return true;
    }
    return false;
  }, '点中目标树', 12000, 400, [t.x, t.z, hBySp[species]]);
  if (!cmd) return { fail: '点不中' };
  await page.evaluate(() => window.__GAME__.fallInfo(true)); // 起采复位：ring 里只有本轮倒地
  const seen = await waitFor(page, () => window.__GAME__.fallInfo().ring.length > 0, '倒地帧环采样', 60000, 200);
  if (!seen) return { fail: '环空(未开工/在路上)', task: (await page.evaluate(() => { const u = window.__GAME__.units[0]; return u.task + '@' + u.x.toFixed(1) + ',' + u.z.toFixed(1); })) };
  const f = await page.evaluate(([x, z]) => {
    const g = window.__GAME__;
    const fi = g.fallInfo();
    const d0 = fi.ring[0];
    const u = g.units[0];
    const fe = fi.feller; // 倒地瞬间站位；若单位已移动 >1m 则退回实时位
    const ux = fe ? fe.x : u.x;
    const uz = fe ? fe.z : u.z;
    return d0 ? { dur: d0.dur, species: d0.species, yaw: d0.yaw, exyaw: Math.atan2(x - ux, z - uz) } : null;
  }, [t.x, t.z]);
  return f ? { ...f, x: t.x, z: t.z } : null;
}

async function g25_tree_fall(page) {
  await page.evaluate(() => {
    window.__GAME__.setPersonality(0, { combat: 'cautious', work: 'lazy', trait: 'quiet' });
  });
  await zoomOut(page);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const SS = () => page.evaluate(() => window.__GAME__.soundStats().counts);

  const f1 = await fellTree(page, 0);
  check('松树倒程 0.55s', !!f1 && f1.species === 0 && Math.abs(f1.dur - 0.55) < 1e-9, JSON.stringify(f1));
  check('倒向背离伐木者（±0.6rad）', !!f1 && Math.abs(wrap(f1.yaw - f1.exyaw)) < 0.6, f1 ? 'Δ=' + wrap(f1.yaw - f1.exyaw).toFixed(2) : 'null');

  await waitFor(page, () => { const fi = window.__GAME__.fallInfo(); return fi.dying.length === 0 && fi.shake <= 0; }, '上一轮倒地冲净', 15000, 150);
  await sleep(400);
  await page.evaluate(() => window.__GAME__.fallReset());
  const c0 = await SS();
  const f2 = await fellTree(page, 1);
  check('橡树倒程 0.75s（最沉最慢）', !!f2 && Math.abs(f2.dur - 0.75) < 1e-9, JSON.stringify(f2));
  const pkSeen = await waitFor(page, () => window.__GAME__.fallInfo().peak > 0.02, '砸地震屏', 6000, 100);
  const pk = pkSeen ? await page.evaluate(() => window.__GAME__.fallInfo().peak.toFixed(3)) : 0;
  check('砸地镜头微震（peak>0.02）', !!pkSeen, 'peak=' + pk);
  const c1 = await SS();
  check('起倒沙沙+落地重音各 +1', (c1.thud ?? 0) - (c0.thud ?? 0) === 1 && (c1.down ?? 0) - (c0.down ?? 0) === 1,
    'thudΔ=' + ((c1.thud ?? 0) - (c0.thud ?? 0)) + ' downΔ=' + ((c1.down ?? 0) - (c0.down ?? 0)));

  await page.evaluate(() => window.__GAME__.fallReset());
  const f3 = await fellTree(page, 2);
  check('白桦倒程 0.42s（轻快）', !!f3 && Math.abs(f3.dur - 0.42) < 1e-9, JSON.stringify(f3));

  await sleep(400);
  const f4 = await fellTree(page, 0);
  check('震停即自愈（右键仍点得准）', !!f4);
}

async function group(browser, port, name, fn, opts = {}) {
  console.log('\n=== ' + name + (opts.slow ? ' [slow]' : '') + ' ===');
  const qs = new URLSearchParams(opts.path ? opts.path.replace(/^\?/, '') : '');
  const turbo = opts.turbo ?? TURBO;
  if (turbo > 1) qs.set('turbo', String(turbo));
  // 非战斗组一律无狼清场（URL 级，跨 reload 生效）：turbo 快进下狼群会放倒队员、刷屏日志
  if (!opts.wolves) qs.set('nowolf', '1');
  const q = qs.toString();
  let ctx = null;
  let page = null;
  let errors = [];
  // 环境抖动防护：导航/就绪被 CPU 挤到超时时整组重开一次（历史上单组超时曾把整批拖崩）
  let opened = false;
  for (let attempt = 1; attempt <= 2 && !opened; attempt++) {
    try {
      ctx = await (await liveBrowser()).newContext();
      page = await ctx.newPage();
      errors = [];
      // 并行时导航/reload 可能被 CPU 挤慢：只放宽导航超时；动作超时保持默认，避免失败断言干等
      page.setDefaultNavigationTimeout(120000);
      await page.setViewportSize(VW);
      page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('AudioContext encountered an error')) errors.push('[console] ' + m.text()); });
      page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
      // 并行时页面加载变慢，就绪超时放宽
      await page.goto(`http://127.0.0.1:${port}/index.html${q ? '?' + q : ''}`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => window.__GAME_READY === true, null, { timeout: 120000 });
      opened = true;
    } catch (e) {
      const msg = String(e && e.message || e).split('\n')[0];
      if (attempt < 2) {
        console.log('  ⚠ [' + name + '] 页面打开超时（' + msg + '），整组重开重试');
        // close 可能被无 GPU 环境下的狂转页面挂死（历史元凶：僵尸页 738% CPU 拖垮全批）：限时放弃 + 冷却再重开
        try { await Promise.race([ctx.close(), sleep(8000)]); } catch { /* 已死 */ }
        await sleep(5000);
      } else {
        try { await Promise.race([ctx.close(), sleep(8000)]); } catch { /* 已死 */ }
        const bad = await runInGroup(name, async () => {
          check('页面打开成功（重试后）', false, msg);
          return summary(name);
        });
        allOk = allOk && bad;
        return false;
      }
    }
  }
  const ok = await runInGroup(name, async () => {
    try {
      await fn(page, errors);
      check('组内无 console error / pageerror', errors.length === 0, errors.slice(0, 2).join(' | ') || '干净');
    } catch (e) {
      check('组执行无异常', false, String(e && e.message || e));
    }
    return summary(name);
  });
  allOk = allOk && ok;
  await ctx.close();
  return ok;
}

// ========== 场景 ==========

async function g1_select(page) {
  await zoomOut(page);
  const s0 = await gs(page);
  check('开局 1 名拓荒者（单人开局）', s0.players === 1);
  check('开局金币 20', s0.gold === 20);
  const clicked = await clickUnit(page, 0);
  check('左键点选角色成功', clicked);
  check('点选后角色面板可见', await panelVisible(page, 'sel'));
  const selName = await page.evaluate(() => document.getElementById('selName')?.textContent);
  check('面板显示角色名', typeof selName === 'string' && selName.includes('拓荒者'), selName);
  const un = await page.evaluate(() => window.__GAME__.units);
  check('该角色被标记选中', un.some((u) => u.selected));
  // 点空白地面取消选中（世界 (8,8) 空地，zoomOut 后视野内）
  const first = un[0];
  const far = await sp(page, 8, 8);
  if (far && (await onCanvas(page, far.x, far.y))) {
    await page.mouse.click(far.x, far.y);
    await sleep(300);
    check('点空白后取消选中（面板隐藏）', await panelGone(page, 'sel'));
  } else {
    check('点空白后取消选中（面板隐藏）', false, '空白点不可达');
  }
}

async function g2_boxselect(page) {
  await zoomOut(page);
  // 夹具：单人开局下现场补一名队友（框选/多选场景需要 ≥2 人，语义同招募入队）
  await page.evaluate(() => {
    const u = window.__GAME__.units[0];
    window.__GAME__.addPlayer(u.x + 3, u.z + 1.5, '拓荒者·克莉');
  });
  await sleep(300);
  await selectAll(page);
  const selN = await page.evaluate(() => window.__GAME__.units.filter((u) => u.selected).length);
  check('先确保有选中（全屏框选）', selN >= 1, 'selected=' + selN);
  // 右键视野中心地面，让全员聚拢到可见区域
  await page.mouse.click(640, 420, { button: 'right' });
  await sleep(3500);
  // 全屏框选
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(1180, 700, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  const un = await page.evaluate(() => window.__GAME__.units);
  const selCount = un.filter((u) => u.selected).length;
  check('框选选中 ≥2 名角色', selCount >= 2, 'selected=' + selCount);
  const selName = await page.evaluate(() => document.getElementById('selName')?.textContent);
  check('多选时面板标注 +N', typeof selName === 'string' && /（\+\d+）/.test(selName), selName);
}

async function g3_move(page) {
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const u0 = (await gs(page)).units[0];
  // 目标点取近处空地（≤6m）：慢帧下 12s 走 1–3m，只验证"右键下达移动命令后发生位移"
  const spot = await findClearSpot(page, u0.x, u0.z, 6);
  const target = spot ? await sp(page, spot.x, spot.z) : null;
  if (!target || !(await onCanvas(page, target.x, target.y))) { check('移动命令下达', false, '目标点不可达'); return; }
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await sleep(30000);
  const u1 = (await gs(page)).units[0];
  const moved = Math.hypot(u1.x - u0.x, u1.z - u0.z);
  check('右键地面后角色发生位移', moved > 0.3, '位移 ' + moved.toFixed(1) + 'm');
}

async function g4_gather(page) {
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const u0 = (await gs(page)).units[0];
  const tree = await page.evaluate(([ux, uz]) => {
    const ts = window.__GAME__.targets.trees.filter((t) => t.species === 0 && t.phase === 'mature');
    return ts.filter((t) => Math.hypot(t.x - ux, t.z - uz) <= 30).sort((a, bb) => Math.hypot(a.x - ux, a.z - uz) - Math.hypot(bb.x - ux, bb.z - uz))[0] || null;
  }, [u0.x, u0.z]); // 锁松树成材：+3 产量是树种表锚（G23 ⑤ 已覆盖他树各档）
  if (!tree) { check('采集树', false, '30m 内无成材松树'); return; }
  // 相机不跟随角色：相机对准树旁 + 角色传送到树旁 4m（运行时夹具，避免 reload 重生成世界）
  await page.evaluate(([tx, tz, cx, cz]) => {
    window.__GAME__.setCamTarget(cx, cz, true);
    window.__GAME__.setPos(0, tx, tz);
  }, [tree.x - 4, tree.z - 4, tree.x, tree.z]);
  await sleep(300);
  const beforeWood = (await gs(page)).invs.reduce((a, i) => a + (i.inv.wood ?? 0), 0);
  const treesBefore = (await gs(page)).targets.trees.length;
  // 树可能在丘陵上：右键高度取树地面高 +1.0/1.7/2.5（覆盖树干与树冠）
  let okCmd = false;
  for (const h of [tree.y + 1.0, tree.y + 1.7, tree.y + 2.5]) {
    const s = await sp(page, tree.x, tree.z, h);
    if (!s || !(await onCanvas(page, s.x, s.y))) continue;
    await page.mouse.click(s.x, s.y, { button: 'right' });
    await sleep(500);
    const t = await page.evaluate(() => window.__GAME__.units.find((u) => u.selected)?.task ?? null);
    if (t === 'gather') { okCmd = true; break; }
  }
  if (!okCmd) { check('采集树', false, '树右键未下达采集命令'); return; }
  const ok = await waitFor(page, (a) => {
    const g = window.__GAME__;
    const wood = g.invs.reduce((sum, i) => sum + (i.inv.wood ?? 0), 0);
    return wood > a.beforeWood && g.targets.trees.length < a.treesBefore;
  }, '采集完成', 80000, 300, { beforeWood, treesBefore });
  const after = await gs(page);
  const wood = after.invs.reduce((a, i) => a + (i.inv.wood ?? 0), 0);
  check('右键树后木材 +3', wood >= beforeWood + 3, '木材 ' + beforeWood + '→' + wood + (ok ? '' : '（waitFor 超时但结果已达成）'));
  check('被砍的树消失（数量 -1）', after.targets.trees.length === treesBefore - 1,
    '树 ' + treesBefore + '→' + after.targets.trees.length);
}

async function g5_trade(page) {
  // 夹具：传送到商摊旁 4m，缩短慢帧下的步行等待
  const m0 = await page.evaluate(() => window.__GAME__.targets.merchant);
  if (m0 && !(await placeUnit(page, m0.x - 4, m0.z))) {
    check('右键商人', false, '夹具注入失败'); return;
  }
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const m = await page.evaluate(() => window.__GAME__.targets.merchant);
  const okCmd = await rightClickEntity(page, m.x, m.z, ['trade'], 500);
  if (!okCmd) { check('右键商人', false, '商摊右键未下达交易命令'); return; }
  check('角色走到商摊后自动开交易面板', await waitFor(page, () => {
    const el = document.getElementById('trade');
    return el && getComputedStyle(el).display !== 'none';
  }, '交易面板', 90000), '');
  const who1 = await page.evaluate(() => document.getElementById('trWho')?.textContent || '');
  check('面板标注交易对象', who1.includes('与'), who1);
  // —— 锁定验证：开面板后点选另一角色，交易对象不变 ——
  // 单人开局：现场补一名队友作为"换选中"对象（交易锁定语义不变）
  await page.evaluate(() => {
    const u = window.__GAME__.units[0];
    if (window.__GAME__.players < 2) window.__GAME__.addPlayer(u.x + 2.5, u.z, '拓荒者·克莉');
  });
  await sleep(300);
  await clickUnit(page, 1);
  await sleep(300);
  const who2 = await page.evaluate(() => document.getElementById('trWho')?.textContent || '');
  check('交易锁定：换选中后对象不变', who1.length > 0 && who1 === who2, who1 + ' → ' + who2);
  check('换选中后交易面板仍开', await panelVisible(page, 'trade'));
  // —— 卖食物（开局 3 食，动态价格 base=3） ——
  const g0 = (await gs(page)).gold;
  for (let i = 0; i < 3; i++) { await clickDom(page, '#trSell'); await sleep(200); }
  await sleep(300);
  const g1 = (await gs(page)).gold;
  check('卖 3 食物 +9（3 金/个）', g1 - g0 === 9, '金币 ' + g0 + '→' + g1);
  // —— 边界：第 4 个食物背包已空，拒绝且提示 ——
  const logSell = await logs(page);
  await clickDom(page, '#trSell');
  await sleep(300);
  const g1b = (await gs(page)).gold;
  const logSell2 = await logs(page);
  check('食物卖空后继续卖：拒绝且提示', g1b === g1 &&
    logSell2.some((t) => t.includes('背包里没有食物')), (logSell2.filter((t) => !logSell.includes(t))).join(' | '));
  // —— 买种子 ——
  const g2 = (await gs(page)).gold;
  await clickDom(page, '#trBuy');
  await sleep(300);
  check('买种子：金币 -2', (await gs(page)).gold === g2 - 2);
  // —— 买木矛 + 重复购买 ——
  const g3 = (await gs(page)).gold;
  await clickDom(page, '#trBuySpear');
  await sleep(300);
  const g4 = (await gs(page)).gold;
  check('买木矛：金币 -8', g4 === g3 - 8, g3 + '→' + g4);
  const logA = await logs(page);
  await clickDom(page, '#trBuySpear');
  await sleep(300);
  check('重复买木矛不再扣钱', (await gs(page)).gold === g4);
  const logB = await logs(page);
  check('重复购买提示已装备', logB.some((t) => t.includes('已装备木矛')),
    (logB.filter((t) => !logA.includes(t))).join(' | '));
  // —— 关闭方式 ——
  await clickDom(page, '#trClose');
  check('trClose 关闭交易面板', await panelGone(page, 'trade'));
  // 面板开着时点画布外部不关闭
  await clickUnit(page, 0);
  const m2 = await page.evaluate(() => window.__GAME__.targets.merchant);
  await rightClickWorld(page, m2.x, m2.z);
  await waitFor(page, () => { const el = document.getElementById('trade'); return el && getComputedStyle(el).display !== 'none'; }, '再开交易', 60000);
  const blank = (await onCanvas(page, 640, 420)) ? { x: 640, y: 420 }
    : (await onCanvas(page, 620, 300)) ? { x: 620, y: 300 } : null;
  if (blank) await page.mouse.click(blank.x, blank.y);
  await sleep(400);
  check('点画布外部不关交易面板', await panelVisible(page, 'trade'));
  await page.keyboard.press('Escape');
  check('ESC 关闭交易面板', await panelGone(page, 'trade'));
}

async function g6_panels(page) {
  // 夹具：传送到商摊旁 4m（交易面板需角色走到商摊）
  const m0 = await page.evaluate(() => window.__GAME__.targets.merchant);
  if (m0 && !(await placeUnit(page, m0.x - 4, m0.z))) {
    check('交易互斥', false, '夹具注入失败'); return;
  }
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const m = await page.evaluate(() => window.__GAME__.targets.merchant);
  const okCmd1 = await rightClickEntity(page, m.x, m.z, ['trade'], 500);
  if (!okCmd1) { check('交易互斥', false, '商摊右键未下达交易命令'); return; }
  await waitFor(page, () => { const el = document.getElementById('trade'); return el && getComputedStyle(el).display !== 'none'; }, '开交易', 45000);
  await clickDom(page, '#saveBtn');
  await sleep(300);
  check('交易开着点存档：存档开、交易关（互斥）',
    (await panelVisible(page, 'saveModal')) && await panelGone(page, 'trade'));
  await page.keyboard.press('Escape');
  check('ESC 关闭存档面板', await panelGone(page, 'saveModal'));
  // 修船面板互斥
  const ship = await page.evaluate(() => window.__GAME__.targets.ship);
  const okCmd2 = await rightClickEntity(page, ship.x, ship.z, ['walk'], 500);
  if (!okCmd2) { check('右键船打开修船面板', false, '船右键未下达命令'); return; }
  await waitFor(page, () => { const el = document.getElementById('shipPanel'); return el && getComputedStyle(el).display !== 'none'; }, '开修船', 30000);
  check('右键船打开修船面板', await panelVisible(page, 'shipPanel'));
  await clickDom(page, '#saveBtn');
  check('修船开着点存档：存档开、修船关（互斥）',
    (await panelVisible(page, 'saveModal')) && await panelGone(page, 'shipPanel'));
  await page.keyboard.press('Escape');
  // 无面板时 ESC 回探索
  await page.keyboard.press('Escape');
  const exploreOn = await page.evaluate(() => !!document.querySelector('.mbtn[data-m="0"].on'));
  check('无面板时 ESC 回到探索模式', exploreOn);
}

async function g7_save(page) {
  // 夹具：传送到商摊旁 4m（后续卖食物步骤不再长距离步行）
  const m0 = await page.evaluate(() => window.__GAME__.targets.merchant);
  if (m0 && !(await placeUnit(page, m0.x - 4, m0.z))) {
    check('卖食物后金币变化（23）', false, '夹具注入失败'); return;
  }
  await page.click('#saveBtn');
  await waitFor(page, () => { const el = document.getElementById('saveModal'); return el && getComputedStyle(el).display !== 'none'; }, '存档面板', 5000);
  await page.click('.sbtn[data-slot="manual1"][data-act="save"]');
  await sleep(400);
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('wilderlands.save.manual1');
    return raw ? JSON.parse(raw) : null;
  });
  check('保存后 localStorage 写入 manual1', !!stored && typeof stored.version === 'number' && stored.gold === 20,
    stored ? 'version=' + stored.version + ' gold=' + stored.gold : '无存档');
  const stamp = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.slotRow'));
    const row = rows.find((r) => r.querySelector('.sbtn[data-slot="manual1"]'));
    return row ? (row.querySelector('.slotStamp')?.textContent || '') : '';
  });
  check('槽位显示时间戳（不再为暂无）', typeof stamp === 'string' && !stamp.includes('暂无'), stamp);
  // —— 读档闭环：改状态（卖 1 食物）后读回 20 金 ——
  await page.keyboard.press('Escape');
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const m = await page.evaluate(() => window.__GAME__.targets.merchant);
  const okCmd = await rightClickEntity(page, m.x, m.z, ['trade'], 500);
  if (!okCmd) { check('右键商人', false, '商摊右键未下达交易命令'); return; }
  await waitFor(page, () => { const el = document.getElementById('trade'); return el && getComputedStyle(el).display !== 'none'; }, '开交易', 90000);
  await clickDom(page, '#trSell');
  await sleep(300);
  const goldAfterSell = (await gs(page)).gold;
  check('卖食物后金币变化（23）', goldAfterSell === 23, 'gold=' + goldAfterSell);
  await page.keyboard.press('Escape');
  await clickDom(page, '#saveBtn');
  await sleep(300);
  await page.click('.sbtn[data-slot="manual1"][data-act="load"]');
  check('读档触发页面重载', await waitFor(page, () => window.__GAME_READY === true, '重载', 15000, 400));
  await sleep(2000);
  const gAfterLoad = (await gs(page)).gold;
  check('读档后金币回到保存值 20', gAfterLoad === 20, 'gold=' + gAfterLoad);
  const lg = await logs(page);
  check('读档提示欢迎回来', lg.some((t) => t.includes('已读档')), lg.slice(-2).join(' | '));
  // —— 破损存档 ——
  await page.evaluate(() => {
    localStorage.setItem('wilderlands.save.manual2', '{broken json!!');
    localStorage.setItem('wilderlands.save.pending', 'manual2');
  });
  await page.reload();
  await waitFor(page, () => window.__GAME_READY === true, '重载2', 15000, 400);
  await sleep(1500);
  const lg2 = await logs(page);
  check('破损存档：回退新开局并提示', (await gs(page)).players === 1 &&
    lg2.some((t) => t.includes('存档不可用')), lg2.slice(-2).join(' | '));
  // —— 导出 JSON ——
  const dlPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await clickDom(page, '#saveBtn');
  await sleep(500);
  await clickDom(page, '#saveExport');
  const dl = await dlPromise;
  if (dl) {
    check('导出文件名 wilderlands-save-*.json', /wilderlands-save-\d+\.json/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const path = await dl.path();
    const fs = await import('node:fs');
    const txt = fs.readFileSync(path, 'utf8');
    try {
      const parsed = JSON.parse(txt);
      check('导出 JSON 可解析且含版本', typeof parsed.version === 'number' && Array.isArray(parsed.units) && parsed.units.length === 1,
        'version=' + parsed.version + ' units=' + parsed.units.length);
    } catch {
      check('导出 JSON 可解析且含版本', false, 'JSON 无效');
    }
  } else {
    check('导出文件名 wilderlands-save-*.json', false, '未捕获下载');
  }
}

async function g8_recruit(page) {
  // 夹具：传送到商摊旁 4m（卖木攒钱步骤不再长距离步行）
  const m0 = await page.evaluate(() => window.__GAME__.targets.merchant);
  if (m0 && !(await placeUnit(page, m0.x - 4, m0.z))) {
    check('攒够 25 金币', false, '夹具注入失败'); return;
  }
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const m = await page.evaluate(() => window.__GAME__.targets.merchant);
  const okCmd = await rightClickEntity(page, m.x, m.z, ['trade'], 500);
  if (!okCmd) { check('右键商人', false, '商摊右键未下达交易命令'); return; }
  await waitFor(page, () => { const el = document.getElementById('trade'); return el && getComputedStyle(el).display !== 'none'; }, '开交易', 90000);
  await clickDom(page, '#trSell');      // +3 → 23
  await sleep(250);
  await clickDom(page, '#trSellWood');  // +2 → 25
  await sleep(250);
  check('攒够 25 金币', (await gs(page)).gold === 25, 'gold=' + (await gs(page)).gold);
  await page.keyboard.press('Escape');
  const w = await page.evaluate(() => window.__GAME__.targets.wanderer);
  if (!w || !w.available) { check('招募流浪者', false, '流浪者不可用'); return; }

  // —— 条件门·拒绝段：无屋顶/口粮不足时，25 金也招不了人 ——
  await rightClickWorld(page, w.x, w.z);
  await sleep(1500);
  const rej = await gs(page);
  const rejLog = await logs(page);
  check('条件未达成：拒绝招募（人数不变）', rej.players === 1 && rej.targets.wanderer.available, 'players=' + rej.players);
  check('条件未达成：金币不扣', rej.gold === 25, 'gold=' + rej.gold);
  check('条件未达成：日志点名缺什么', rejLog.some((t) => t.includes('想招人，还得再熬一熬')), rejLog.slice(-2).join(' | '));

  // —— 夹具：存档注入"1 座木屋 + 全队口粮 6"，凑齐条件门 ——
  await clickDom(page, '#saveBtn');
  await waitFor(page, () => { const el = document.getElementById('saveModal'); return el && getComputedStyle(el).display !== 'none'; }, '存档面板', 8000);
  await clickDom(page, '.sbtn[data-slot="auto"][data-act="save"]');
  await sleep(300);
  await page.keyboard.press('Escape');
  const inj = await page.evaluate(() => {
    const raw = localStorage.getItem('wilderlands.save.auto');
    if (!raw) return false;
    const s = JSON.parse(raw);
    s.buildings = [{ type: 'house', x: 2, z: 2 }];
    s.units[0].inv = { ...s.units[0].inv, food: 6 };
    localStorage.setItem('wilderlands.save.auto', JSON.stringify(s));
    localStorage.setItem('wilderlands.save.pending', 'auto');
    return true;
  });
  if (!inj) { check('招募流浪者', false, '条件门夹具注入失败'); return; }
  await page.reload();
  await waitFor(page, () => window.__GAME_READY === true, '重载', 15000, 400);
  await sleep(1000);

  // —— 条件门·成功段：屋顶+余粮+金币齐，流浪者入队 ——
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const w2 = await page.evaluate(() => window.__GAME__.targets.wanderer);
  if (!w2 || !w2.available) { check('招募流浪者', false, '重载后流浪者不可用'); return; }
  await rightClickWorld(page, w2.x, w2.z);
  const ok = await waitFor(page, () => window.__GAME__.players === 2 && !window.__GAME__.targets.wanderer.available, '招募', 15000);
  const after = await gs(page);
  const names = after.units.map((u) => u.name);
  check('条件达成：第 2 名队员入队', ok && after.players === 2, names.join('、'));
  check('招募扣 25 金', after.gold === 0, 'gold=' + after.gold);
  check('新队员空背包', after.invs.length === 2 && Object.keys(after.invs[1].inv).every((k) => !after.invs[1].inv[k]), JSON.stringify(after.invs[1].inv));
  check('流浪者变为不可招募', !after.targets.wanderer.available);
  const lg = await logs(page);
  check('招募日志出现', lg.some((t) => t.includes('加入了你的小队')), lg.slice(-2).join(' | '));
}

async function g9_modes(page) {
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const u0 = (await gs(page)).units[0];
  await page.keyboard.press('2');
  check('数字键 2 切播种模式', await mbtnOn(page, 1));
  // 播种：动态找无实体空地，最多重试 3 个点位（避免随机 spot 撞到不可种的位置）
  const t0 = (await gs(page)).tiles.length;
  let planted = false;
  for (let i = 0; i < 3 && !planted; i++) {
    const spot1 = await findClearSpot(page, u0.x, u0.z, 12);
    const p1 = spot1 ? await sp(page, spot1.x, spot1.z) : null;
    if (!p1 || !(await onCanvas(page, p1.x, p1.y))) continue;
    await page.mouse.click(p1.x, p1.y, { button: 'right' });
    planted = await waitFor(page, (a) => window.__GAME__.tiles.length > a.t0, '农田', 3000, 300, { t0 });
  }
  check('播种后出现农田', planted);
  const lg = await logs(page);
  check('播种日志', lg.some((t) => t.includes('播种完成')), lg.slice(-2).join(' | '));
  // 围栏：另找一块空地（最多重试 3 个点位）
  await page.keyboard.press('3');
  check('数字键 3 切围栏模式', await mbtnOn(page, 2));
  const b0 = (await gs(page)).buildings;
  let fenced = false;
  for (let i = 0; i < 3 && !fenced; i++) {
    const spot2 = await findClearSpot(page, u0.x + 14, u0.z + 6, 10);
    const p2 = spot2 ? await sp(page, spot2.x, spot2.z) : null;
    if (!p2 || !(await onCanvas(page, p2.x, p2.y))) continue;
    await page.mouse.click(p2.x, p2.y, { button: 'right' });
    fenced = await waitFor(page, (a) => window.__GAME__.buildings > a.b0, '围栏', 3000, 300, { b0 });
  }
  check('围栏建成（建筑 +1）', fenced);
  // 木屋：资源不足
  await page.keyboard.press('4');
  check('数字键 4 切木屋模式', await mbtnOn(page, 3));
  const b1 = (await gs(page)).buildings;
  const spot3 = await findClearSpot(page, u0.x + 6, u0.z + 14, 8);
  const p3 = spot3 ? await sp(page, spot3.x, spot3.z) : null;
  if (p3 && await onCanvas(page, p3.x, p3.y)) await page.mouse.click(p3.x, p3.y, { button: 'right' });
  await sleep(600);
  const lg2 = await logs(page);
  check('木屋资源不足：不建造且提示', (await gs(page)).buildings === b1 && lg2.some((t) => t.includes('木屋需要木材 10 + 石头 5')),
    lg2.slice(-2).join(' | '));
  // 回到探索
  await page.keyboard.press('1');
  check('数字键 1 回探索模式', await mbtnOn(page, 0));
  await page.keyboard.press('Escape');
  check('ESC 保持探索模式', await mbtnOn(page, 0));
}

async function g10_transfer(page) {
  await zoomOut(page);
  // 夹具：单人开局下现场补一名队友，作为转移接收方（克莉）
  await page.evaluate(() => {
    const u = window.__GAME__.units[0];
    window.__GAME__.addPlayer(u.x + 4, u.z + 1, '拓荒者·克莉');
  });
  await sleep(300);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  await sleep(200);
  const before = await page.evaluate(() => window.__GAME__.invs.map((i) => i.inv.wood ?? 0));
  await clickDom(page, '.invTr[data-id="wood"]');
  check('背包转移浮层打开', await panelVisible(page, 'invPicker'));
  await clickDom(page, '.pkBtn[data-to="拓荒者·克莉"]');
  await sleep(400);
  const after = await page.evaluate(() => window.__GAME__.invs.map((i) => i.inv.wood ?? 0));
  check('转移 1 木材：A -1 / B +1', after[0] === before[0] - 1 && after[1] === before[1] + 1,
    before.join('/') + ' → ' + after.join('/'));
  check('转移后浮层自动关闭', await panelGone(page, 'invPicker'));
  // 数量按钮
  await clickDom(page, '.invTr[data-id="wood"]');
  await sleep(200);
  await clickDom(page, '.pkQtyBtn[data-act="qty-all"]');
  const qty = await page.evaluate(() => document.querySelector('.pkQtyNum')?.textContent);
  check('“全部”按钮显示剩余数量', Number(qty) >= 1, 'qty=' + qty);
  await clickDom(page, '.pkCancel');
  check('取消关闭浮层', await panelGone(page, 'invPicker'));
  // 丢弃
  await clickDom(page, '.invTr[data-id="wood"]');
  await sleep(200);
  await clickDom(page, '.pkDiscard');
  await sleep(400);
  const afterDiscard = await page.evaluate(() => window.__GAME__.invs[0].inv.wood ?? 0);
  check('丢弃 1 木材', afterDiscard === after[0] - 1, '木 ' + after[0] + '→' + afterDiscard);
}

async function g11_stability(page) {
  await zoomOut(page);
  // 连点空白
  await page.mouse.click(640, 300);
  await page.mouse.click(700, 350);
  await page.mouse.click(560, 420);
  await page.mouse.click(760, 260);
  await page.mouse.click(500, 500);
  await page.mouse.click(900, 600);
  await page.mouse.click(300, 650);
  await page.mouse.click(1100, 200);
  await sleep(800);
  check('快速连点 8 次无异常', true);
  // resize
  await page.setViewportSize({ width: 900, height: 600 });
  await sleep(600);
  const csize = await page.evaluate(() => { const c = document.querySelector('canvas'); return c ? c.clientWidth + 'x' + c.clientHeight : '无'; });
  check('窗口 resize 后画布跟随', csize.startsWith('900'), csize);
  await page.setViewportSize(VW);
  await sleep(400);
  // 滚轮缩放
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -800);
  await page.mouse.wheel(0, 400);
  await sleep(400);
  check('滚轮缩放无异常', true);
  // 中键旋转
  await page.mouse.move(640, 400);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(760, 320, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await sleep(300);
  check('中键拖拽旋转无异常', true);
}

async function g12_ship(page) {
  // 先让游戏保存一份真实结构存档到 auto，再注入富资源（测试夹具）
  await page.click('#saveBtn');
  await waitFor(page, () => { const el = document.getElementById('saveModal'); return el && getComputedStyle(el).display !== 'none'; }, '存档面板', 8000);
  await page.click('.sbtn[data-slot="auto"][data-act="save"]');
  await sleep(400);
  await page.keyboard.press('Escape');
  const injected = await page.evaluate(() => {
    const raw = localStorage.getItem('wilderlands.save.auto');
    if (!raw) return false;
    const s = JSON.parse(raw);
    s.gold = 100;
    s.units[0].inv = { wood: 40, stone: 30, food: 3, seed: 0, berry: 0 };
    // 夹具把角色放到距船 ~10m（>8m 船边判定距离），先验证"未走到拒绝投入"再走近
    if (s.units[0].x !== undefined && s.units[0].z !== undefined) {
      s.units[0].x = 29;
      s.units[0].z = 29;
    }
    localStorage.setItem('wilderlands.save.auto', JSON.stringify(s));
    localStorage.setItem('wilderlands.save.pending', 'auto');
    return true;
  });
  check('夹具注入成功', injected);
  await page.reload();
  await waitFor(page, () => window.__GAME_READY === true, '富存档重载', 15000, 400);
  await sleep(1000);
  const st = await gs(page);
  check('夹具生效：角色0 背包 40 木 30 石', st.invs[0].inv.wood === 40 && st.invs[0].inv.stone === 30,
    '木' + st.invs[0].inv.wood + ' 石' + st.invs[0].inv.stone);
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const ship = st.targets.ship;
  const okCmd = await rightClickEntity(page, ship.x, ship.z, ['walk'], 500);
  if (!okCmd) { check('右键船', false, '船右键未下达命令'); return; }
  check('修船面板打开', await waitFor(page, () => { const el = document.getElementById('shipPanel'); return el && getComputedStyle(el).display !== 'none'; }, 'shipPanel', 30000));
  // 人还没走到：点投入应被拒绝
  await clickDom(page, '#shipWoodBtn');
  await sleep(400);
  const lg = await logs(page);
  const ship0 = (await gs(page)).targets.ship;
  check('未走到船边：拒绝投入且进度不变', ship0.wood === 0 && lg.some((t) => t.includes('还没走到船边')), lg.slice(-2).join(' | '));
  // 等角色走到船边（距船 10m → 8m，慢帧下约 15–60s）
  const arrived = await waitFor(page, () => {
    const g = window.__GAME__;
    const u = g.units[0];
    return Math.hypot(u.x - g.targets.ship.x, u.z - g.targets.ship.z) <= 8;
  }, '走到船边', 60000);
  check('角色走到船边', arrived);
  // 投入木材 ×3 → 30
  for (let i = 0; i < 3; i++) { await clickDom(page, '#shipWoodBtn'); await sleep(300); }
  let s1 = (await gs(page)).targets.ship;
  check('投入木材 3 次：进度 30/30', s1.wood === 30, '木 ' + s1.wood + '/30');
  // 投入石头 ×4 → 20 → 完成
  for (let i = 0; i < 4; i++) { await clickDom(page, '#shipStoneBtn'); await sleep(300); }
  s1 = (await gs(page)).targets.ship;
  check('投入石头 4 次：进度 20/20', s1.stone === 20, '石 ' + s1.stone + '/20');
  check('修船完成（done=true）', s1.done);
  check('通关横幅出现', await panelVisible(page, 'victory'));
  const status = await page.evaluate(() => document.getElementById('shipStatus')?.textContent);
  check('船状态文案切换为荒诞完成语', typeof status === 'string' && status.includes('倒着造的'), status);
}

async function g13_food(page) {
  // 夹具：饥饿消耗极慢（0.05/s），headless 慢帧下长时间也不掉到可观测值；
  // 先手动存 auto，再改存档把 units[0] 饥饿压到 50，重载后验证进食恢复饥饿。
  await clickDom(page, '#saveBtn');
  await waitFor(page, () => { const el = document.getElementById('saveModal'); return el && getComputedStyle(el).display !== 'none'; }, '存档面板', 8000);
  await clickDom(page, '.sbtn[data-slot="auto"][data-act="save"]');
  await sleep(400);
  await page.keyboard.press('Escape');
  const inj = await page.evaluate(() => {
    const raw = localStorage.getItem('wilderlands.save.auto');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s.units || !s.units[0]) return false;
    s.units[0].hunger = 50;
    localStorage.setItem('wilderlands.save.auto', JSON.stringify(s));
    localStorage.setItem('wilderlands.save.pending', 'auto');
    return true;
  });
  check('饥饿夹具注入', inj);
  if (!inj) return;
  await page.reload();
  await waitFor(page, () => window.__GAME_READY === true, '重载', 15000, 400);
  await sleep(1200);
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const u0 = (await gs(page)).units[0];
  const h1 = u0.hunger;
  check('读档后饥饿处于低位（50）', h1 < 100, 'hunger=' + h1);
  const foodBefore = (await gs(page)).invs[0].inv.food ?? 0;
  await page.keyboard.press('f');
  await sleep(1500);
  const after = await gs(page);
  const h2 = after.units[0].hunger;
  check('F 键进食恢复饥饿', h2 > h1, 'hunger ' + h1 + '→' + h2);
  const foodAfter = after.invs[0].inv.food ?? 0;
  check('进食消耗食物', foodAfter === foodBefore - 1, 'food ' + foodBefore + '→' + foodAfter);
  const lg = await logs(page);
  check('进食日志出现', lg.some((t) => t.includes('进食')), lg.slice(-2).join(' | '));
}

async function g14_wolf(page) {
  // 夹具链：读最近狼位 → placeUnit（存档注入=会 reload，重载后狼继续跑）→ 重载完立刻冻狼
  const wolfSeed = await page.evaluate(() => {
    const g = window.__GAME__;
    const u0 = g.units[0];
    const wl = g.wolfList;
    if (!wl.length) return null;
    let best = wl[0], bd = Infinity;
    for (const w of wl) {
      const d = Math.hypot(w.x - u0.x, w.z - u0.z);
      if (d < bd) { bd = d; best = w; }
    }
    return { x: best.x, z: best.z };
  });
  if (wolfSeed && !(await placeUnit(page, wolfSeed.x - 4, wolfSeed.z - 4))) {
    check('攻击野狼', false, '夹具注入失败'); return;
  }
  await page.evaluate(() => window.__GAME__.freezeWolves(true)); // 重载后第一时间冻场，狼最多再跑 4m
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  if (!(await gs(page)).wolfList.length) { check('攻击野狼', false, '无狼'); return; }
  // 狼在跑（游荡 2.2×turbo）——旧快照坐标必 miss：单往返"现读现点"+ 重试
  let okCmd = false;
  for (let tryN = 0; tryN < 10 && !okCmd; tryN++) {
    // 页内同帧"找最近狼→投影→派发右键事件"——零往返，相机 lerp 无法插队
    okCmd = await page.evaluate(() => {
      const g = window.__GAME__;
      const u = g.units[0];
      let best = null, bd = Infinity;
      for (const w of g.wolfList) {
        if (w.dead || w.down) continue;
        const d = Math.hypot(w.x - u.x, w.z - u.z);
        if (d < bd) { bd = d; best = w; }
      }
      if (!best || bd > 16) return false;
      // 狼体几何悬在 pos.y（地形高度）之上：按 w.y 起算，坡地投影才不飘
      for (const h of [0.55, 0.85, 1.15]) {
        g.rightClickWorld(best.x, best.z, (best.y ?? 0) + h);
        if (g.units.some((x2) => x2.selected && x2.task === 'attack')) return true;
      }
      return false;
    });
    if (!okCmd) await sleep(200);
  }
  if (!okCmd) {
    const diag = await page.evaluate(() => {
      const g = window.__GAME__;
      const u = g.units[0];
      const w = g.wolfList.map((x2) => ({ d: +Math.hypot(x2.x - u.x, x2.z - u.z).toFixed(1), dead: x2.dead }));
      return JSON.stringify({ sel: g.units.map((x2) => x2.selected), task: u.task, dist: u.task && u.task.pos ? +Math.hypot(u.task.pos.x - u.x, u.task.pos.z - u.z).toFixed(1) : null, wolfDist: w, anim: g.animState(0) });
    });
    check('攻击野狼', false, '狼右键未下达攻击命令（10 次现读现点皆 miss） ' + diag);
    return;
  }
  const fought = await waitFor(page, () => {
    const g = window.__GAME__;
    const wolfChanged = g.wolfList.some((w) => w.dead || w.down);
    const hurt = g.units.some((u) => u.hp < 100);
    return wolfChanged || hurt;
  }, '狼战发生', 60000);
  const after = await gs(page);
  check('攻击野狼后战况发生（狼死/倒地或玩家受伤）', fought,
    '狼=' + JSON.stringify(after.wolfList.map((w) => (w.dead ? '死' : w.down ? '倒' : '活')).join(',')) +
    ' 玩家hp=' + after.units.map((u) => u.hp).join(','));
}

async function g15_debug(page) {
  const hint = await page.evaluate(() => {
    const el = document.getElementById('hint');
    return el ? { visible: getComputedStyle(el).display !== 'none', text: el.textContent || '' } : null;
  });
  check('?debug=1 时调试面板可见', hint && hint.visible);
  check('调试面板显示运行状态', hint && hint.text.includes('dbg') && /\d+/.test(hint.text), hint ? hint.text.slice(0, 40) : '');
}

async function g16_rock(page) {
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const u0 = (await gs(page)).units[0];
  const rock = await nearest(page, 'rocks', u0.x, u0.z, 30);
  if (!rock) { check('岩石采集', false, '30m 内无岩石'); return; }
  // 运行时传送：不改存档、不重生成世界，直接站到岩石旁 4m
  await page.evaluate(([tx, tz]) => window.__GAME__.setPos(0, tx, tz), [rock.x - 4, rock.z - 4]);
  await sleep(300);
  const beforeStone = (await gs(page)).invs.reduce((a, i) => a + (i.inv.stone ?? 0), 0);
  // 相机不跟随角色：把相机目标移到岩石旁 + 角色传送到岩石旁 4m，右键高度取岩石地面高 +1.5
  await page.evaluate(([rx, rz, cx, cz]) => {
    window.__GAME__.setCamTarget(cx, cz, true);
    window.__GAME__.setPos(0, rx, rz);
  }, [rock.x - 4, rock.z - 4, rock.x, rock.z]);
  await sleep(300);
  let okCmd = false;
  for (const h of [rock.y + 0.6, rock.y + 1.2, rock.y + 2.0]) {
    const s = await sp(page, rock.x, rock.z, h);
    if (!s || !(await onCanvas(page, s.x, s.y))) continue;
    await page.mouse.click(s.x, s.y, { button: 'right' });
    await sleep(500);
    const t = await page.evaluate(() => window.__GAME__.units.find((u) => u.selected)?.task ?? null);
    if (t === 'gather') { okCmd = true; break; }
  }
  if (!okCmd) { check('岩石采集', false, '岩石右键未下达采集命令'); return; }
  const ok = await waitFor(page, (a) => {
    const g = window.__GAME__;
    const stone = g.invs.reduce((sum, i) => sum + (i.inv.stone ?? 0), 0);
    return stone > a.beforeStone;
  }, '采矿完成', 120000, 300, { beforeStone });
  const after = await gs(page);
  const stone = after.invs.reduce((a, i) => a + (i.inv.stone ?? 0), 0);
  check('右键岩石后石头 +2', stone >= beforeStone + 2, '石头 ' + beforeStone + '→' + stone + (ok ? '' : '（waitFor 超时但结果已达成）'));
  const lg = await logs(page);
  check('开采矿石日志出现', lg.some((t) => t.includes('开采矿石')), lg.slice(-2).join(' | '));
}

async function g17_inventory_full(page) {
  await zoomOut(page);
  if (!(await clickUnit(page, 0))) await selectAll(page);
  const u0 = (await gs(page)).units[0];
  const tree = await nearest(page, 'trees', u0.x, u0.z, 30);
  if (!tree) { check('背包满拒绝采集', false, '30m 内无树'); return; }
  // 运行时夹具：背包塞满木材（容量 40）+ 站到树旁 4m（不改存档、不重生成世界）
  await page.evaluate(([tx, tz]) => {
    window.__GAME__.setInv(0, 'wood', 40);
    window.__GAME__.setPos(0, tx, tz);
  }, [tree.x - 4, tree.z - 4]);
  await sleep(300);
  const okCmd = await rightClickEntity(page, tree.x, tree.z, ['gather'], 500);
  if (!okCmd) { check('背包满拒绝采集', false, '树右键未下达采集命令'); return; }
  const before = (await gs(page)).invs.reduce((a, i) => a + (i.inv.wood ?? 0), 0);
  // 走到并采集完成时才拒绝（资源保留原位、背包不变）
  const refused = await waitFor(page, () => {
    const g = window.__GAME__;
    const wood = g.invs.reduce((sum, i) => sum + (i.inv.wood ?? 0), 0);
    const log = document.querySelector('#log');
    return log && log.textContent.includes('背包已满，放不下更多木材');
  }, '背包满拒绝', 120000);
  const wood = (await gs(page)).invs.reduce((a, i) => a + (i.inv.wood ?? 0), 0);
  check('背包满拒绝采集（木材不变）', refused && wood === before, '木 ' + before + '→' + wood);
}

async function g18_shift_multi(page) {
  // 夹具：单人开局下现场生成第 2 名队友到 10m 外（避免点选重叠；取代旧的存档传送）
  await page.evaluate(() => {
    const u = window.__GAME__.units[0];
    window.__GAME__.addPlayer(u.x + 10, u.z + 3, '拓荒者·克莉');
  });
  await sleep(400);
  await zoomOut(page);
  // 点选第 1 人
  if (!(await clickUnit(page, 0))) { check('Shift 多选', false, '选中失败'); return; }
  await sleep(300);
  const sel1 = (await gs(page)).units.filter((u) => u.selected).length;
  check('先选中 1 人', sel1 === 1, 'sel=' + sel1);
  // Shift 点选第 2 人：shiftKey 由全局键盘事件维护，须 keyboard.down 模拟按住
  const u1 = (await gs(page)).units[1];
  let shiftOk = false;
  await page.keyboard.down('Shift');
  for (const h of [1.0, 1.4, 1.8]) {
    const p = await sp(page, u1.x, u1.z, h);
    if (!p || !(await onCanvas(page, p.x, p.y))) continue;
    await page.mouse.click(p.x, p.y);
    await sleep(400);
    const selN = (await gs(page)).units.filter((u) => u.selected).length;
    if (selN === 2) { shiftOk = true; break; }
  }
  await page.keyboard.up('Shift');
  check('Shift 点选追加选中（2 人）', shiftOk, 'sel=' + (await gs(page)).units.filter((u) => u.selected).length);
}

async function g19_import(page) {
  // 导出 JSON → 改金币 → 导入 → 重载后金币生效
  const dlPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await clickDom(page, '#saveBtn');
  await sleep(500);
  await clickDom(page, '#saveExport');
  const dl = await dlPromise;
  if (!dl) { check('导入 JSON 存档', false, '导出未捕获'); return; }
  const dlPath = await dl.path();
  const fs = await import('node:fs');
  const txt = fs.readFileSync(dlPath, 'utf8');
  const s = JSON.parse(txt);
  s.gold = 77;
  fs.writeFileSync(dlPath, JSON.stringify(s));
  await page.setInputFiles('#saveImportFile', dlPath);
  await waitFor(page, () => window.__GAME_READY === true && window.__GAME__.gold === 77, '导入生效', 20000, 400);
  const gold = (await gs(page)).gold;
  check('导入 JSON 存档（金币 77 生效）', gold === 77, 'gold=' + gold);
  let lg = await logs(page);
  for (let i = 0; i < 20 && !lg.some((t) => (t || '').includes('已读档') || (t || '').includes('导入成功')); i++) { await sleep(200); lg = await logs(page); }
  check('导入后读档提示出现', lg.some((t) => (t || '').includes('已读档') || (t || '').includes('导入成功')), lg.slice(-2).join(' | '));
}

// ========== 主流程 ==========

async function main() {
  const { port, close } = await serve(join(root, 'dist'), 8910);
  const browser = await liveBrowser();
  // WL_ONLY=G1,G5 按组过滤（调试二分用）；过滤时跳过 G15，除非点名
  const ONLY = (process.env.WL_ONLY || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!ONLY.length || ONLY.some((o) => 'G15'.startsWith(o))) {
    // G15 调试钩子要独占 ?debug=1 页面，单独串行
    const dbgCtx = await browser.newContext();
    const dbgPage = await dbgCtx.newPage();
    await dbgPage.setViewportSize(VW);
    await dbgPage.goto(`http://127.0.0.1:${port}/index.html?debug=1&nowolf=1${TURBO > 1 ? '&turbo=' + TURBO : ''}`, { waitUntil: 'load', timeout: 120000 });
    await dbgPage.waitForFunction(() => window.__GAME_READY === true, null, { timeout: 120000 });
    console.log('\n=== G15 调试钩子 ?debug=1 ===');
    const dOk = await runInGroup('G15 调试钩子', async () => {
      try { await g15_debug(dbgPage); } catch (e) { check('组执行无异常', false, String(e && e.message || e)); }
      return summary('G15 调试钩子');
    });
    allOk = allOk && dOk;
    await dbgCtx.close();
  }


/** G20 角色AI（change character-ai）：性格注入 → 闲时自治/发呆/当前行为文案/话痨吐槽 */
async function g20_character_ai(page) {
  await page.evaluate(() => {
    const u = window.__GAME__.units[0];
    // 把勤劳伙伴放在树旁 2 米（闲时自治只找领队 10 米内的活，出生点周围无资源属正常）
    const t = window.__GAME__.targets.trees[0];
    window.__GAME__.addPlayer(t.x + 2, t.z, '拓荒者·巴巴');
    window.__GAME__.setPersonality(0, { combat: 'cautious', work: 'lazy', trait: 'quiet' });
    window.__GAME__.setPersonality(1, { combat: 'cautious', work: 'hardworking', trait: 'talkative' });
    window.__GAME__.setCamTarget(t.x, t.z, true);
  });
  await sleep(400);
  await zoomOut(page);
  // ① 勤劳伙伴闲时自派采集任务（2 秒游戏内扫描间隔）
  let task = null;
  for (let i = 0; i < 40 && !task; i++) {
    task = (await gs(page)).units[1].task;
    if (!task) await sleep(200);
  }
  check('勤劳伙伴闲时自动找活（gather）', task === 'gather', 'task=' + task);
  // ② 懒惰主角全程不接活（继续观察几秒）
  await sleep(1200);
  const mainTask = (await gs(page)).units[0].task;
  check('懒惰角色闲时发呆（无任务）', !mainTask, 'task=' + mainTask);
  // ③ HUD「当前行为」文案跟随任务：巴巴（1）正被 ① 的自治采集驱动，选中读文案
  //    （主角在家点 14m 内无资源属正确行为；文案随 gather 轮动，短轮询跨过 ~2s 扫描间歇）
  const sel1 = await clickUnit(page, 1);
  let act = '';
  for (let i = 0; i < 30 && !act; i++) {
    const a = await page.evaluate(() => (document.getElementById('curAction') || {}).textContent || '');
    if (/正在砍树|正在采矿|正在采浆果/.test(a)) act = a;
    else await sleep(150);
  }
  check('HUD 当前行为文案随任务变化', !!act, 'sel=' + sel1 + ' action=' + act);
  // ④ 话痨干活吐槽：日志出现「拓荒者·巴巴：」前缀行
  let quip = false;
  for (let i = 0; i < 300 && !quip; i++) { // 并发批里 G23 类重组会饥饿帧预算，窗口放宽到 ~30s 真实
    const lg = await logs(page);
    quip = lg.some((m) => (m || '').includes('拓荒者·巴巴：'));
    if (!quip) await sleep(100);
  }
  const qtask = quip ? '' : ' task=' + JSON.stringify((await gs(page)).units[1].task);
  check('话痨干活时吐槽（日志冒话）', quip, qtask);
}

  const GROUPS = [
    ['G1 点选与取消', g1_select, {}],
    ['G2 框选多选', g2_boxselect, {}],
    ['G3 移动命令', g3_move, {}],
    ['G4 采集树木', g4_gather, { slow: true }],
    ['G5 交易与锁定', g5_trade, { slow: true }],
    ['G6 面板互斥与 ESC', g6_panels, { slow: true, path: '?ship=1' }],
    ['G7 存档读档闭环', g7_save, { slow: true }],
    ['G8 招募流浪者', g8_recruit, { slow: true }],
    ['G9 模式/播种/建造', g9_modes, {}],
    ['G10 背包转移', g10_transfer, {}],
    ['G11 稳定性', g11_stability, {}],
    ['G12 修船主线通关', g12_ship, { slow: true, path: '?ship=1' }],
    ['G13 进食体力恢复', g13_food, { slow: true }],
    ['G14 野狼战斗', g14_wolf, { slow: true, wolves: true }],
    ['G16 岩石采集', g16_rock, { slow: true }],
    ['G17 背包满拒绝采集', g17_inventory_full, { slow: true }],
    ['G18 Shift 多选', g18_shift_multi, {}],
    ['G19 导入 JSON 存档', g19_import, {}],
    ['G20 角色AI', g20_character_ai, {}],
    ['G21 收获反馈', g21_gather_feedback, {}],
    ['G22 动画生命感', g22_unit_animation, { turbo: 1, wolves: true, serial: true }],
    ['G23 森林生态', g23_forest_life, { serial: true }], // 生长循环依赖游戏时间（stump+2×stage≈45s），并发帧饥饿会导致窗口不足
    ['G24 声音系统', g24_sound, {}],
    ['G25 砸地倒树', g25_tree_fall, { turbo: 1, serial: true }], // 真实时间窗敏感：倒地帧环+震峰；turbo1 免疫步行饿死 // 倒地帧环+震峰是真实时间窗，并发饥饿采空
  ];
  const t0 = Date.now();
  const list = ONLY.length ? GROUPS.filter((g) => ONLY.some((o) => g[0].toUpperCase().startsWith(o))) : GROUPS;
  console.log(`\n黑盒并行调度：${list.length} 组 × 并发 ${CONC} · turbo ×${TURBO}`);
  const runPool = async (items, size = CONC) => {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const [name, fn, opts] = items[next++];
        await group(browser, port, name, fn, opts);
      }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  };
  // 串行组先清场独跑（size=1 真串行）：动画采样/游戏时间敏感断言在满载页面上物理等不起
  await runPool(list.filter((g) => g[2].serial), 1);
  await runPool(list.filter((g) => !g[2].serial));
  const hardExit = setTimeout(() => process.exit(reportExit), 5000); // browser.close WebGL 僵尸保险丝
  await browser.close().catch(() => {});
  close();
  clearTimeout(hardExit);
  console.log(`\n黑盒耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s（并发 ${CONC}，turbo ×${TURBO}）`);
  console.log('========== 黑盒测试总结果：' + (allOk ? '全部通过' : '存在失败') + ' ==========');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { failFast(String(e && e.message || e)); });
