/**
 * Wilderlands · 修船面板（S4 主线，荒诞基调）
 * 右键破船打开：显示荒诞文案、材料进度、投入按钮（需走到船边）。
 * 材料集齐 → 船翻正 + 狼船长登场 + 通关横幅（自由模式继续）。
 */
import { CFG } from '../config';
import { sfx } from '../core/sound';
import type { Unit } from '../types';
import { logMsg, selected } from '../state';
import { invRemove } from '../systems/inventory';
import { donateToShip, ship, shipReady } from '../systems/ship';
import { finishShipVisual } from '../entities/ship';
import { closeAllPanels } from './panels';

const panel = document.getElementById('shipPanel') as HTMLElement;

function shipPos(): { x: number; z: number } {
  return CFG.shipPos;
}

/** 锁定修船角色：右键破船时记录派去船边的角色，避免玩家途中切换选中导致"人明明到了却点不动" */
let workers: Unit[] = [];

/** 是否有人站在船边（优先锁定角色；面板由右键打开，锁定总是存在） */
function nearShip(): boolean {
  const p = shipPos();
  const list = workers.length ? workers : selected;
  return list.some((u) => {
    const d = Math.hypot(u.pos.x - p.x, u.pos.z - p.z);
    return d <= CFG.shipNearDist;
  });
}

function refresh(): void {
  const woodLeft = Math.max(0, CFG.shipWoodNeed - ship.wood);
  const stoneLeft = Math.max(0, CFG.shipStoneNeed - ship.stone);
  (document.getElementById('shipWood') as HTMLElement).textContent =
    '木材 ' + ship.wood + '/' + CFG.shipWoodNeed;
  (document.getElementById('shipStone') as HTMLElement).textContent =
    '石头 ' + ship.stone + '/' + CFG.shipStoneNeed;
  (document.getElementById('shipStatus') as HTMLElement).textContent = ship.done
    ? '这艘船……倒着造的，但能开。'
    : woodLeft + stoneLeft > 0
      ? '还差木材 ' + woodLeft + '、石头 ' + stoneLeft + '。'
      : '材料齐了，动手修吧！';
  (document.getElementById('shipWoodBtn') as HTMLButtonElement).disabled = ship.done || woodLeft === 0;
  (document.getElementById('shipStoneBtn') as HTMLButtonElement).disabled = ship.done || stoneLeft === 0;
}

export function openShip(ws?: Unit[]): void {
  workers = ws && ws.length ? [...ws] : [];
  closeAllPanels();
  panel.style.display = 'flex';
  refresh();
}

function donate(id: 'wood' | 'stone'): void {
  if (ship.done) return;
  if (!nearShip()) {
    logMsg('人还没走到船边，先过去再修');
    return;
  }
  const amount = id === 'wood' ? CFG.shipDonateWood : CFG.shipDonateStone;
  const u = workers.find((x) => !x.down) ?? selected.find((x) => !x.down);
  if (!u) {
    logMsg('先选中一名拓荒者再干活');
    return;
  }
  if (!invRemove(u, id, amount)) {
    logMsg('背包里' + (id === 'wood' ? '木材' : '石头') + '不足 ' + amount + ' 个');
    return;
  }
  donateToShip(id, amount);
  sfx('repair'); logMsg((id === 'wood' ? '木材' : '石头') + ' -' + amount + '，修船进度推进');
  if (shipReady(ship.wood, ship.stone)) {
    finishShipVisual();
    showVictory();
  }
  refresh();
}

/** 通关横幅：荒诞文案 + 自由模式提示（数秒后消失） */
function showVictory(): void {
  const b = document.getElementById('victory') as HTMLElement;
  b.style.display = 'flex';
  setTimeout(() => { b.style.display = 'none'; }, 8000);
}

export function initShipUI(): void {
  (document.getElementById('shipWoodBtn') as HTMLElement).addEventListener('click', () => donate('wood'));
  (document.getElementById('shipStoneBtn') as HTMLElement).addEventListener('click', () => donate('stone'));
  (document.getElementById('shipClose') as HTMLElement).addEventListener('click', () => {
    panel.style.display = 'none';
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.style.display = 'none';
  });
}

/** 右键狼船长：荒诞台词（由 commands 调用） */
export function talkCaptain(): void {
  const lines = [
    '（船长，一头穿水手服的野狼）嗷——我是船长。船是倒着造的，但能开。',
    '（船长）这片荒野没有海。可我的船，就是搁浅在这儿了。习惯就好。',
    '（船长）要我说，你们也别修什么灯塔了——那玩意儿是头鹿建的。',
  ];
  logMsg(lines[Math.floor(Math.random() * lines.length)]);
}
