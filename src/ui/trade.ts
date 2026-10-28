/**
 * Wilderlands · 交易面板
 * 出售食物/木材/石头换金币（价格随当日成交量浮动），购买种子/木矛。所有资源买卖作用于 selected[0] 的背包。
 */
import { CFG, ITEMS } from '../config';
import { sfx } from '../core/sound';
import type { Unit } from '../types';
import { addGold, gold, logMsg, selected, trySpendGold } from '../state';
import { invAdd, invCanAdd, invCount, invRemove } from '../systems/inventory';
import { buyPrice, recordSold, soldToday } from '../systems/trade';
import type { SellId } from '../systems/trade';
import { closeAllPanels } from './panels';

const tradeEl = document.getElementById('trade') as HTMLElement;

/** 锁定交易对象：由"走到商摊的角色"打开面板时记录，避免玩家途中/开面板后切换选中导致操作对象漂移 */
let locked: Unit | null = null;

/** 当前交易对象：锁定角色（倒地则失效） */
function trader(): Unit | null {
  if (!locked || locked.down) {
    logMsg('交易对象不在身边或已倒地，请重新右键商人');
    return null;
  }
  return locked;
}

function refresh(): void {
  const u = trader();
  const who = document.getElementById('trWho') as HTMLElement;
  if (who) who.textContent = u ? '（与 ' + u.name + ' 交易）' : '';
  const f = u ? invCount(u.inv, 'food') : 0;
  const w = u ? invCount(u.inv, 'wood') : 0;
  const s = u ? invCount(u.inv, 'stone') : 0;
  const sd = u ? invCount(u.inv, 'seed') : 0;
  (document.getElementById('trCrop') as HTMLElement).textContent =
    '食物 ×' + f + ' · ' + buyPrice('food', soldToday.food) + ' 金/个';
  (document.getElementById('trWood') as HTMLElement).textContent =
    '木材 ×' + w + ' · ' + buyPrice('wood', soldToday.wood) + ' 金/个';
  (document.getElementById('trStone') as HTMLElement).textContent =
    '石头 ×' + s + ' · ' + buyPrice('stone', soldToday.stone) + ' 金/个';
  (document.getElementById('trSeed') as HTMLElement).textContent =
    '种子 ×' + sd + ' · ' + CFG.seedPrice + ' 金/个';
  (document.getElementById('trSpear') as HTMLElement).textContent =
    '木矛 · ' + CFG.spearPrice + ' 金 · 攻击 +' + CFG.spearAtk;
  (document.getElementById('trGold') as HTMLElement).textContent = String(gold);
}

export function openTrade(u?: Unit): void {
  locked = u && !u.down ? u : (selected[0] && !selected[0].down ? selected[0] : null);
  closeAllPanels();
  tradeEl.style.display = 'flex';
  refresh();
}

function sellOne(id: SellId): void {
  const u = trader();
  if (!u) return;
  if (!invRemove(u, id, 1)) {
    logMsg('背包里没有' + ITEMS[id].label + '可卖');
    return;
  }
  const price = recordSold(id);
  addGold(price);
  sfx('coin');
  refresh();
  logMsg('出售' + ITEMS[id].label + ' +' + price + ' 金币（卖得越多价越低，天亮回升）');
}

export function initTrade(): void {
  (document.getElementById('trSell') as HTMLElement).addEventListener('click', () => {
    sellOne('food');
  });
  (document.getElementById('trSellWood') as HTMLElement).addEventListener('click', () => {
    sellOne('wood');
  });
  (document.getElementById('trSellStone') as HTMLElement).addEventListener('click', () => {
    sellOne('stone');
  });
  (document.getElementById('trBuy') as HTMLElement).addEventListener('click', () => {
    const u = trader();
    if (!u) return;
    if (!invCanAdd(u, 'seed', 1)) {
      logMsg(u.name + ' 背包已满，放不下更多种子');
      return;
    }
    if (!trySpendGold(CFG.seedPrice)) {
      logMsg('金币不足（种子需 ' + CFG.seedPrice + ' 金）');
      return;
    }
    invAdd(u, 'seed', 1);
    refresh();
    logMsg('购入种子 ×1');
  });
  (document.getElementById('trBuySpear') as HTMLElement).addEventListener('click', () => {
    const u = trader();
    if (!u) return;
    if (u.hasSpear) {
      logMsg(u.name + ' 已装备木矛');
      return;
    }
    if (!trySpendGold(CFG.spearPrice)) {
      logMsg('金币不足（木矛需 ' + CFG.spearPrice + ' 金）');
      return;
    }
    u.equipSpear();
    refresh();
  });
  (document.getElementById('trClose') as HTMLElement).addEventListener('click', () => {
    tradeEl.style.display = 'none';
  });
  tradeEl.addEventListener('click', (e) => {
    if (e.target === tradeEl) tradeEl.style.display = 'none';
  });
}
