/**
 * 玩家体验探针：以新玩家视角走一遍前几分钟，截图 + 数据留证。
 * 用法: node scripts/experience-probe.mjs  （需 dev server 在 :5199）
 */
import { chromium } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 5199, VW = { width: 1280, height: 800 };
mkdirSync('_px', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VW });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push('[console] ' + m.text()));
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

async function shot(name) {
  await page.screenshot({ path: `_px/${name}.png` });
  console.log('shot:', name);
}
async function sp(x, z, h = 1) {
  const p = await page.evaluate(([a, b, c]) => window.__GAME__.proj(a, b, c), [x, z, h]);
  if (!p.inFront || p.x < 4 || p.x > VW.width - 4 || p.y < 4 || p.y > VW.height - 4) return null;
  return { x: p.x, y: p.y };
}
const gs = () => page.evaluate(() => ({
  gold: __GAME__.gold, invs: __GAME__.invs, time: __GAME__.time,
  targets: __GAME__.targets, units: __GAME__.units,
}));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
await page.waitForFunction(() => window.__GAME_READY === true, null, { timeout: 20000 });
await sleep(1000);

// 1) 新玩家第一眼
await shot('01_first_sight');

// 2) 帧率
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  (function f() { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : res(Math.round(n / ((performance.now() - t0) / 1000))); })();
}));
console.log('FPS(headless swiftshader):', fps);

// 3) 点击选中 → 面板
const u0 = (await gs()).units[0];
let s = await sp(u0.x, u0.z, 1.2);
if (s) { await page.mouse.click(s.x, s.y); await sleep(400); await shot('02_unit_selected'); }

// 4) 拉远看世界密度（"空旷感"证据）
await page.mouse.move(640, 400);
for (let i = 0; i < 22; i++) await page.mouse.wheel(0, 800);
await sleep(600);
await shot('03_zoomed_out_world');
for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -800); // 拉回
await sleep(400);

// 5) 右键最近的树采集，等 6 秒看背包变化
let g = await gs();
const me = g.units[0];
const near = g.targets.trees.map((t) => ({ t, d: Math.hypot(t.x - me.x, t.z - me.z) })).sort((a, b) => a.d - b.d)[0];
if (near) {
  await page.evaluate(([x, z]) => window.__GAME__.setCamTarget(x, z), [near.t.x, near.t.z]);
  await sleep(500);
  s = await sp(near.t.x, near.t.z, near.t.y + 1);
  if (s) {
    await page.mouse.click(s.x, s.y, { button: 'right' });
    await sleep(1500); await shot('04_walking_to_tree');
    await sleep(6000);
    g = await gs();
    const wood = g.invs[0].inv.wood;
    console.log('采集后 木材:', wood, '(初始', u0 && 3, ')  task:', g.units[0].task);
    await shot('05_after_gather');
  } else console.log('树出屏，跳过采集');
}

// 6) 商摊：镜头移过去，右键打开贸易面板
g = await gs();
await page.evaluate(([x, z]) => { window.__GAME__.setCamTarget(x, z); }, [g.targets.merchant.x, g.targets.merchant.z]);
await sleep(600);
s = await sp(g.targets.merchant.x, g.targets.merchant.z, 1.5);
if (s) { await page.mouse.click(s.x, s.y, { button: 'right' }); await sleep(500); }
await shot('06_trade_panel');

// 7) 修船主线：镜头去看破船
await page.evaluate(([x, z]) => window.__GAME__.setCamTarget(x, z), [g.targets.ship.x, g.targets.ship.z]);
await sleep(600);
await shot('07_the_ship');

// 8) WASD 平移手感（按住 D 1 秒）
await page.mouse.move(640, 400);
await page.keyboard.down('d'); await sleep(1000); await page.keyboard.up('d');
await sleep(300);
await shot('08_after_camera_pan');

// 9) 窄屏 / 手机尺寸（README 提过右键不稳，看布局）
await page.setViewportSize({ width: 480, height: 850 });
await sleep(600);
await shot('09_mobile_480');

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
