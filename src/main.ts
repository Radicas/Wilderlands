/**
 * Wilderlands · 游戏入口
 * 初始化世界、小队、UI 与输入，驱动主循环。
 */
import * as THREE from 'three';
import { renderer, scene, camera, updateCamera, resize, updateCameraMove } from './core/renderer';
import { buildGround, buildMerchant, buildRocks, buildTrees } from './core/world';
import { createPlayers, PioneerUnit } from './entities/unit';
import { players, selected, wolves } from './state';
import { spawnWolf, updateWolves, updateWorld } from './systems/combat';
import { updateFarms } from './systems/farm';
import { initInput, keys } from './core/input';
import { initHUD, updateHUD } from './ui/hud';
import { initTrade, openTrade } from './ui/trade';

// ===== 初始化世界 =====
buildGround();
buildTrees();
buildRocks();
buildMerchant();

// ===== 小队与野狼 =====
createPlayers();
for (let i = 0; i < 3; i++) spawnWolf();

// ===== UI 与输入 =====
initHUD();
initTrade();
initInput();
players.forEach((u) => {
  if (u instanceof PioneerUnit) u.setTradeCallback(openTrade);
});

// ===== 主循环 =====
const clock = new THREE.Clock();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function loop(): void {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  updateCameraMove(keys, dt);
  updateFarms(dt);
  updateWolves(dt);
  updateWorld(dt);
  players.forEach((u) => u.update(dt));
  wolves.forEach((w) => w.update(dt));

  if (!reducedMotion) {
    players.forEach((u, i) => {
      if (u instanceof PioneerUnit) u.markerTick(dt);
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
