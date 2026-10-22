/**
 * Wilderlands · 交易面板
 * 出售食物换金币、购买种子。由游商触发。
 */
import { CFG } from '../config';
import { bag, logMsg } from '../state';

const tradeEl = document.getElementById('trade') as HTMLElement;

function refresh(): void {
  (document.getElementById('trCrop') as HTMLElement).textContent =
    '食物 ×' + bag.food + ' · ' + CFG.cropPrice + ' 金/个';
  (document.getElementById('trSeed') as HTMLElement).textContent =
    '种子 ×' + bag.seed + ' · ' + CFG.seedPrice + ' 金/个';
  (document.getElementById('trGold') as HTMLElement).textContent = String(bag.gold);
}

export function openTrade(): void {
  tradeEl.style.display = 'flex';
  refresh();
}

export function initTrade(): void {
  (document.getElementById('trSell') as HTMLElement).addEventListener('click', () => {
    if (bag.food < 1) return;
    bag.food -= 1;
    bag.gold += CFG.cropPrice;
    refresh();
    logMsg('出售食物 +' + CFG.cropPrice + ' 金币');
  });
  (document.getElementById('trBuy') as HTMLElement).addEventListener('click', () => {
    if (bag.gold < CFG.seedPrice) return;
    bag.gold -= CFG.seedPrice;
    bag.seed += 1;
    refresh();
    logMsg('购入种子 ×1');
  });
  (document.getElementById('trClose') as HTMLElement).addEventListener('click', () => {
    tradeEl.style.display = 'none';
  });
  tradeEl.addEventListener('click', (e) => {
    if (e.target === tradeEl) tradeEl.style.display = 'none';
  });
}
