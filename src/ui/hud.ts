/**
 * Wilderlands · HUD（头顶信息层）
 * 消息日志、资源栏（金币 + 小队合计）、选中角色面板（含个人背包 + 转移交互）、模式按钮、新手提示。
 */
import { CFG, ITEMS, SKILL_LABELS } from '../config';
import type { ItemId, SkillId, Unit } from '../types';
import { gold, modeNow, players, selected, setLogHandler, setMode } from '../state';
import { invCount, invRatio, invTotal, transferItem } from '../systems/inventory';
import { skillLevel, skillOf } from '../systems/skills';
import { timePhaseLabel } from '../systems/daynight';

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

// 日志绑定须在启动期最早完成：读档欢迎/坏档提示在 initHUD 之前写入，
// 若走默认 console 实现会丢失（黑盒测试发现）。
setLogHandler(logMsgImpl);

export function initHUD(): void {
  // 模式切换按钮（点击 = 数字键 1-4）
  document.querySelectorAll('.mbtn').forEach((b) => {
    b.addEventListener('click', () => setMode(Number((b as HTMLElement).dataset.m)));
  });
  // 新手提示关闭
  const hintX = document.getElementById('hintX');
  hintX?.addEventListener('click', () => {
    const hint = document.getElementById('hint');
    if (hint) hint.style.display = 'none';
  });

  // 背包转移交互（事件委托，避免每帧重绑）
  const selEl = document.getElementById('sel') as HTMLElement;
  selEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.invTr') as HTMLElement | null;
    if (btn) openTransferPicker(btn.dataset.id as ItemId);
  });
  document.getElementById('invPicker')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.pkBtn') as HTMLElement | null;
    if (!btn) return;
    const act = btn.dataset.act as string;
    const from = players.find((p) => p === selected[0]);
    if (!from || !currentTransferItem) return;
    if (act === 'qty-down') { transferQty = Math.max(1, transferQty - 1); renderTransferPicker(); return; }
    if (act === 'qty-up') { transferQty = Math.min(currentMaxQty(), transferQty + 1); renderTransferPicker(); return; }
    if (act === 'qty-all') { transferQty = currentMaxQty(); renderTransferPicker(); return; }
    const id = currentTransferItem;
    const n = transferQty;
    currentTransferItem = null;
    closeTransferPicker();
    const toName = btn.dataset.to as string;
    if (toName === '__cancel' || !id) return;
    if (toName === '__discard') {
      transferItem(from, null, id, n);
    } else {
      const to = players.find((p) => p.name === toName);
      if (to) transferItem(from, to, id, n);
    }
  });
}

// ---- 背包转移（S5：批量数量 + 目标行显示可收量） ----
let currentTransferItem: ItemId | null = null;
let transferQty = 1;
const selEl0 = document.getElementById('sel') as HTMLElement;

/** 可转移的最大数量 = 持有数（丢弃口径） */
function currentMaxQty(): number {
  const from = selected[0];
  if (!from || !currentTransferItem) return 1;
  return Math.max(1, invCount(from.inv, currentTransferItem));
}

function openTransferPicker(id: ItemId): void {
  currentTransferItem = id;
  transferQty = 1;
  renderTransferPicker();
}

function renderTransferPicker(): void {
  const picker = document.getElementById('invPicker') as HTMLElement;
  const list = document.getElementById('invPickerList') as HTMLElement;
  if (!picker || !list) return;
  const id = currentTransferItem;
  const from = selected[0];
  if (!id || !from) return;
  const have = invCount(from.inv, id);
  const max = Math.max(1, have);
  const n = Math.min(transferQty, max);
  transferQty = n;
  const targets = players.filter((p) => p !== from && !p.down);
  list.innerHTML =
    '<div class="pkTitle">' + ITEMS[id].label + ' · 背包 ' + have + ' 个</div>' +
    '<div class="pkQty">' +
      '<button class="pkBtn pkQtyBtn" data-act="qty-down">−</button>' +
      '<span class="pkQtyNum">' + n + '</span>' +
      '<button class="pkBtn pkQtyBtn" data-act="qty-up">＋</button>' +
      '<button class="pkBtn pkQtyBtn" data-act="qty-all">全部</button>' +
    '</div>' +
    targets
      .map((p) => {
        const canGet = Math.floor((p.capacity - invTotal(p.inv)) / ITEMS[id].weight);
        const recv = Math.min(canGet, have);
        return '<button class="pkBtn" data-to="' + p.name + '">给 ' + p.name +
          ' ×' + n + '（可收 ' + Math.max(0, recv) + ' · 负重 ' + Math.round(invRatio(p) * 100) + '%）</button>';
      })
      .join('') +
    '<button class="pkBtn pkDiscard" data-to="__discard">丢弃 ×' + n + '</button>' +
    '<button class="pkBtn pkCancel" data-to="__cancel">取消</button>';
  picker.style.display = 'block';
}

function closeTransferPicker(): void {
  const picker = document.getElementById('invPicker') as HTMLElement;
  if (picker) picker.style.display = 'none';
}

export function updateHUD(selected: Unit[]): void {
  // 资源栏：金币（公共）+ 小队背包合计
  const sq = { wood: 0, stone: 0, food: 0, seed: 0, berry: 0 };
  for (const u of players) {
    for (const k of Object.keys(sq) as (keyof typeof sq)[]) sq[k] += u.inv[k] ?? 0;
  }
  (document.getElementById('rGold') as HTMLElement).textContent = String(gold);
  (document.getElementById('rWood') as HTMLElement).textContent = String(sq.wood);
  (document.getElementById('rStone') as HTMLElement).textContent = String(sq.stone);
  (document.getElementById('rFood') as HTMLElement).textContent = String(sq.food);
  (document.getElementById('rSeed') as HTMLElement).textContent = String(sq.seed);
  (document.getElementById('rBerry') as HTMLElement).textContent = String(sq.berry);
  (document.getElementById('rTime') as HTMLElement).textContent = timePhaseLabel();

  // 模式按钮高亮
  document.querySelectorAll('.mbtn').forEach((b) => {
    const el = b as HTMLElement;
    el.classList.toggle('on', Number(el.dataset.m) === modeNow);
  });

  // 选中角色面板
  const u = selected[0];
  selEl0.style.display = selected.length ? 'block' : 'none';
  if (!u) {
    closeTransferPicker();
    return;
  }
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

  // 技能（熟练度）
  let skHtml = '';
  for (const id of Object.keys(SKILL_LABELS) as SkillId[]) {
    skHtml += SKILL_LABELS[id] + ' Lv' + skillLevel(skillOf(u, id)) + '　';
  }
  (document.getElementById('skills') as HTMLElement).textContent = skHtml.trim();

  // 当前行为（spec 011）
  const moodLabel: Record<string, string> = {
    fear: '害怕中', irritable: '烦躁', exhausted: '疲惫', downcast: '低落', neutral: '',
  };
  let action = '';
  if (u.down) action = '倒地恢复中';
  else if (u.task) {
    if (u.task.type === 'attack') action = '战斗中';
    else if (u.task.type === 'trade') action = '走向商摊';
    else if (u.task.kind === 'tree') action = '正在砍树';
    else if (u.task.kind === 'rock') action = '正在采矿';
    else if (u.task.kind === 'berry') action = '正在采浆果';
    else if (u.task.kind === 'crop') action = '正在收获';
    else action = '移动中';
  } else if (u.mood !== 'neutral') action = moodLabel[u.mood] ?? '';
  else action = '空闲';
  (document.getElementById('curAction') as HTMLElement).textContent = action;

  // 背包：负重条 + 物品列表
  const load = invTotal(u.inv);
  const loadEl = document.getElementById('loadFill') as HTMLElement;
  loadEl.style.width = Math.min(100, (load / u.capacity) * 100) + '%';
  loadEl.style.background = invRatio(u) >= CFG.overloadRatio ? '#d08830' : '#7a8a4a';
  (document.getElementById('invLoad') as HTMLElement).textContent = load + '/' + u.capacity;
  const invList = document.getElementById('invList') as HTMLElement;
  let invHtml = '';
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const n = invCount(u.inv, id);
    invHtml +=
      '<div class="invRow">' +
      '<span class="invName">' + ITEMS[id].label + ' <b>×' + n + '</b>' +
      '<span class="invDesc">重 ' + ITEMS[id].weight + '/个 · ' + ITEMS[id].desc + '</span>' +
      '</span>' +
      '<button class="invTr" data-id="' + id + '" title="转移/丢弃">→</button>' +
      '</div>';
  }
  invList.innerHTML = invHtml;
}
