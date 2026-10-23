/**
 * Wilderlands · Game Over（spec 012）
 * 所有 player 同时 down/dead 持续 3 秒 → 触发团灭结算。
 */
import { players } from '../state';
import { logMsg } from './log';

let _gameOver = false;
let _allDownT = 0;
let _overCallback: (() => void) | null = null;

export function isGameOver(): boolean {
  return _gameOver;
}

export function setGameOverCallback(fn: () => void): void {
  _overCallback = fn;
}

/** 主循环每帧调用：检测是否全灭 */
export function updateGameOver(dt: number): void {
  if (_gameOver) return;
  const alive = players.filter((u) => !u.down && !u.dead);
  if (alive.length === 0) {
    _allDownT += dt;
    if (_allDownT >= 3) {
      _gameOver = true;
      logMsg('拓荒队全灭了…');
      _overCallback?.();
    }
  } else {
    _allDownT = 0;
  }
}

/** 重置（读档/重开时调用） */
export function resetGameOver(): void {
  _gameOver = false;
  _allDownT = 0;
}
