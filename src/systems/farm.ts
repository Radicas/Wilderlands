/**
 * Wilderlands · 种田系统
 * 播种 → 生长（家园快 / 野外慢）→ 成熟收获。
 */
import { CFG } from '../config';
import type { Tile, Unit } from '../types';
import { logMsg, tiles } from '../state';
import { invRemove } from './inventory';
import { gainSkill } from './skills';
import { tileMats } from '../core/world';

export function plantTile(tile: Tile, from: Unit): boolean {
  if (tile.state !== 0) {
    logMsg('这块地已有作物或正在生长');
    return false;
  }
  if (!invRemove(from, 'seed', 1)) {
    logMsg('种子不足，去贸易站买一些吧');
    return false;
  }
  tile.state = 1;
  tile.grow = 0;
  tile.mesh.visible = true;
  tile.mesh.material = tileMats[1];
  gainSkill(from, 'farm', 1);
  logMsg(from.name + ' 播种完成，等待生长');
  return true;
}

export function updateFarms(dt: number): void {
  for (const t of tiles) {
    if (t.state === 0 || t.state === 3) continue;
    t.grow += dt / (t.isHome ? CFG.growHome : CFG.growWild);
    if (t.grow >= 0.45 && t.state === 1) {
      t.state = 2;
      t.mesh.material = tileMats[2];
    }
    if (t.grow >= 1) {
      t.state = 3;
      t.mesh.material = tileMats[3];
      t.ear.visible = true;
    }
  }
}
