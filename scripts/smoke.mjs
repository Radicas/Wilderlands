/**
 * Wilderlands · 冒烟测试（黑盒冒烟：游戏真的能跑）
 * 断言：页面加载 / 无致命错误 / 渲染非空 / 开局状态 / HUD 数值 / 面板初始关闭。
 * 用法：node scripts/smoke.mjs        （需先 npm run build 生成 dist）
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, openGame, check, resetCount, summary, failFast } from './_e2e-util.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const { port, close } = await serve(join(root, 'dist'));
  const { browser, page, errors } = await openGame(port);
  resetCount();

  // —— 1. 页面与渲染 ——
  const title = await page.title();
  check('页面标题正确', title.includes('荒野开拓者'), title);

  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    return { w: c.width, h: c.height, sw: c.clientWidth, sh: c.clientHeight };
  });
  check('canvas 存在且非零尺寸', !!canvasInfo && canvasInfo.w > 0 && canvasInfo.h > 0,
    canvasInfo ? canvasInfo.sw + 'x' + canvasInfo.sh : '无 canvas');

  const shot = await page.screenshot({ type: 'png' });
  check('渲染画面非空（截图 > 12KB）', shot.length > 12000, shot.length + ' bytes');

  // —— 2. 无致命错误 ——
  check('无 console error / pageerror', errors.length === 0, errors.slice(0, 3).join(' | ') || '干净');

  // —— 3. 开局状态（只读钩子） ——
  const s = await page.evaluate(() => {
    const g = window.__GAME__;
    return {
      gold: g.gold, players: g.players, wolves: g.wolves, berries: g.berries,
      time: g.time, units: g.units,
    };
  });
  check('开局金币 = 20', s.gold === 20, 'gold=' + s.gold);
  check('开局 1 名拓荒者（单人开局）', s.players === 1, 'players=' + s.players);
  check('开局 3 匹野狼', s.wolves === 3, 'wolves=' + s.wolves);
  check('开局有浆果丛', s.berries > 0, 'berries=' + s.berries);
  check('时辰在 [0,1) 区间', s.time >= 0 && s.time < 1, 't=' + s.time.toFixed(3));
  check('主角罗恩存活', s.units.length === 1 && s.units[0].name === '拓荒者·罗恩' && !s.units[0].down && s.units[0].hp > 0,
    s.units.map((u) => u.name.slice(0, 6)).join('、'));

  // —— 4. HUD 数值（单人开局：木3 石2 食3 种1） ——
  const hud = await page.evaluate(() => ({
    g: document.getElementById('rGold')?.textContent,
    w: document.getElementById('rWood')?.textContent,
    st: document.getElementById('rStone')?.textContent,
    f: document.getElementById('rFood')?.textContent,
    sd: document.getElementById('rSeed')?.textContent,
    b: document.getElementById('rBerry')?.textContent,
    t: document.getElementById('rTime')?.textContent,
  }));
  check('HUD 金币=20', hud.g === '20', 'rGold=' + hud.g);
  check('HUD 木材=3（单人开局）', hud.w === '3', 'rWood=' + hud.w);
  check('HUD 石头=2（单人开局）', hud.st === '2', 'rStone=' + hud.st);
  check('HUD 食物=3（单人开局）', hud.f === '3', 'rFood=' + hud.f);
  check('HUD 种子=1（单人开局）', hud.sd === '1', 'rSeed=' + hud.sd);
  check('HUD 浆果=0', hud.b === '0', 'rBerry=' + hud.b);
  check('HUD 时辰非空', typeof hud.t === 'string' && hud.t.length > 0, 'rTime=' + hud.t);

  // —— 5. UI 骨架与面板初始关闭 ——
  const ui = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el ? getComputedStyle(el).display : 'missing'; };
    return {
      modes: document.querySelectorAll('.mbtn').length,
      saveBtn: !!document.getElementById('saveBtn'),
      hint: vis('hint'),
      sel: vis('sel'), trade: vis('trade'), shipPanel: vis('shipPanel'),
      saveModal: vis('saveModal'), invPicker: vis('invPicker'), victory: vis('victory'),
    };
  });
  check('底部模式按钮 4 枚（探索/播种/围栏/木屋，spec unit-control）', ui.modes === 4, 'mbtn=' + ui.modes);
  check('存档按钮存在', ui.saveBtn);
  check('新手提示可见', ui.hint === 'block');
  const hidden = ['sel', 'trade', 'shipPanel', 'saveModal', 'invPicker', 'victory'];
  const bad = hidden.filter((id) => ui[id] !== 'none');
  check('所有面板初始关闭（' + hidden.join('/') + '）', bad.length === 0, bad.join(',') || '全部 none');

  const ok = summary('冒烟测试');
  await browser.close();
  close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { failFast(String(e && e.message || e)); });
