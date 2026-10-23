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

/** 面板可见性（display block/flex 即视为可见） */
export async function panelVisible(page, id) {
  return page.evaluate((pid) => {
    const el = document.getElementById(pid);
    if (!el) return false;
    const d = getComputedStyle(el).display;
    return d === 'block' || d === 'flex';
  }, id);
}

/** 断言计数 */
let pass = 0;
let fail = 0;
export function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  [' + extra + ']' : '')); }
}
export function resetCount() { pass = 0; fail = 0; }
export function summary(title) {
  console.log(`\n== ${title}：${pass} 通过 / ${fail} 失败 ==`);
  return fail === 0;
}

export function failFast(msg) {
  console.log('\n\u2717 前置失败：' + msg);
  process.exit(1);
}
