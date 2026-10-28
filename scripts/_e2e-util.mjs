/**
 * Wilderlands · E2E 测试共享工具（冒烟 + 黑盒）
 * 职责：起静态服务器（serve dist 产物）、启动 headless Chromium、
 *       等待游戏就绪、收集控制台错误、断言计数器。
 * 仅测试基础设施，不触碰游戏逻辑。
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';

/** 起静态 HTTP 服务器（python3 自带，无需额外依赖），返回 { port, close } */
export async function serve(distDir, port = 8899) {
  const proc = spawn(
    'python3', ['-m', 'http.server', String(port), '--directory', distDir],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (res.ok) return { port, close: () => proc.kill() };
    } catch { /* 端口未就绪 */ }
    await sleep(250);
  }
  proc.kill();
  throw new Error('静态服务器启动失败（python3 -m http.server）');
}

/** 打开游戏页面：等待 __GAME_READY、收集 console error 与页面异常 */
export async function openGame(port, path = '') {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const url = `http://127.0.0.1:${port}/${path}`;
  await page.goto(url, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => window.__GAME_READY === true, null, { timeout: 20000 });
  return { browser, page, errors };
}

/** 读游戏只读钩子状态（evaluate 包装，等待可用） */
export async function gameState(page) {
  return page.evaluate(() => {
    const g = window.__GAME__;
    return {
      gold: g.gold, players: g.players, wolves: g.wolves, berries: g.berries,
      time: g.time, invs: g.invs, wanderer: g.wanderer,
      units: g.units, wolfList: g.wolfList, targets: g.targets,
      buildings: g.buildings, tiles: g.tiles,
    };
  });
}

/** 世界坐标 → 屏幕坐标（页内投影） */
export async function proj(page, x, z) {
  return page.evaluate(([px, pz]) => window.__GAME__.proj(px, pz), [x, z]);
}

/** 面板可见性：瞬时读 + 短轮询（HUD 每帧才同步 DOM，turbo/并发下瞬时读易撞帧间隙） */
const VIS_FN = (pid) => {
  const el = document.getElementById(pid);
  if (!el) return false;
  const d = getComputedStyle(el).display;
  return d === 'block' || d === 'flex';
};
export async function panelVisible(page, id, timeout = 4000) {
  if (await page.evaluate(VIS_FN, id)) return true;
  return page.waitForFunction(VIS_FN, id, { timeout, polling: 100 }).then(() => true).catch(() => false);
}
export async function panelGone(page, id, timeout = 4000) {
  const gone = (pid) => {
    const el = document.getElementById(pid);
    if (!el) return true;
    const d = getComputedStyle(el).display;
    return d !== 'block' && d !== 'flex';
  };
  if (await page.evaluate(gone, id)) return true;
  return page.waitForFunction(gone, id, { timeout, polling: 100 }).then(() => true).catch(() => false);
}

/** 断言计数（AsyncLocalStorage 按组隔离：并行跑组时互不串扰；无组上下文归入汇总桶） */
import { AsyncLocalStorage } from 'node:async_hooks';
const als = new AsyncLocalStorage();
const counts = new Map();
function bucket() {
  const g = als.getStore() || '_';
  let c = counts.get(g);
  if (!c) { c = { pass: 0, fail: 0 }; counts.set(g, c); }
  return c;
}
export function runInGroup(title, fn) { return als.run(title, fn); }
export function check(name, cond, extra = '') {
  const g = als.getStore();
  const c = bucket();
  const tag = g ? `[${g.split(' ')[0]}] ` : '';
  if (cond) { c.pass++; console.log('  \u2713 ' + tag + name + (extra ? '  [' + extra + ']' : '')); }
  else { c.fail++; console.log('  \u2717 ' + tag + name + (extra ? '  [' + extra + ']' : '')); }
}
export function resetCount() { counts.clear(); }
export function summary(title) {
  const own = counts.get(title);
  const c = own || [...counts.values()].reduce((a, b) => ({ pass: a.pass + b.pass, fail: a.fail + b.fail }), { pass: 0, fail: 0 });
  console.log(`\n== ${title}：${c.pass} 通过 / ${c.fail} 失败 ==`);
  return c.fail === 0;
}

export function failFast(msg) {
  console.log('\n\u2717 前置失败：' + msg);
  process.exit(1);
}
