/**
 * Wilderlands · HUD（头顶信息层）
 * 消息日志、资源栏、选中角色面板、模式按钮、新手提示。
 */
import type { Unit } from '../types';
import { bag, modeNow, setLogHandler, setMode } from '../state';

const logEl = document.getElementById('log') as HTMLElement;

function logMsgImpl(s: string): void {
  const el = document.createElement('div');
  el.className = 'msg';
  el.textContent = s;
  logEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  while (logEl.children.length > 5) logEl.removeChild(logEl.firstChild!);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 500);
  }, 5000);
}

export function initHUD(): void {
  setLogHandler(logMsgImpl);

  // 模式切换按钮
  document.querySelectorAll('.mbtn').forEach((b) => {
    b.addEventListener('click', () => setMode(Number((b as HTMLElement).dataset.m)));
  });

  // 新手提示关闭
  const hintX = document.getElementById('hintX');
  hintX?.addEventListener('click', () => {
    const hint = document.getElementById('hint');
    if (hint) hint.style.display = 'none';
  });
}

const selEl = document.getElementById('sel') as HTMLElement;

export function updateHUD(selected: Unit[]): void {
  // 资源栏
  (document.getElementById('rGold') as HTMLElement).textContent = String(bag.gold);
  (document.getElementById('rWood') as HTMLElement).textContent = String(bag.wood);
  (document.getElementById('rStone') as HTMLElement).textContent = String(bag.stone);
  (document.getElementById('rFood') as HTMLElement).textContent = String(bag.food);
  (document.getElementById('rSeed') as HTMLElement).textContent = String(bag.seed);

  // 模式按钮高亮
  document.querySelectorAll('.mbtn').forEach((b) => {
    const el = b as HTMLElement;
    el.classList.toggle('on', Number(el.dataset.m) === modeNow);
  });

  // 选中角色面板
  const u = selected[0];
  selEl.style.display = selected.length ? 'block' : 'none';
  if (u) {
    const hp = Math.max(0, Math.ceil(u.hp));
    const hg = Math.max(0, Math.ceil(u.hunger));
    (document.getElementById('selName') as HTMLElement).textContent =
      u.name +
      (selected.length > 1 ? '（+' + (selected.length - 1) + '）' : '') +
      (u.down ? ' · 倒地恢复中' : '');
    (document.getElementById('hpFill') as HTMLElement).style.width = hp + '%';
    (document.getElementById('hpTxt') as HTMLElement).textContent = hp + '/100';
    (document.getElementById('hungerFill') as HTMLElement).style.width = hg + '%';
    (document.getElementById('hungerTxt') as HTMLElement).textContent = '饥饿 ' + hg;
    const l = u.limbs;
    (document.getElementById('limbs') as HTMLElement).innerHTML =
      '头 ' + Math.ceil(l.头) +
      '　躯干 ' + Math.ceil(l.躯干) +
      '　左臂 ' + Math.ceil(l.左臂) +
      '　右臂 ' + Math.ceil(l.右臂) +
      '　左腿 ' + Math.ceil(l.左腿) +
      '　右腿 ' + Math.ceil(l.右腿);
  }
}
