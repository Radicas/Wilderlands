/**
 * Wilderlands · 存档菜单
 * 右上角按钮 → 模态框：自动槽 + 3 手动槽（保存/读取/时间戳）、导出 JSON、导入 JSON。
 */
import { logMsg } from '../state';
import { exportSave, importSave, loadRequest, saveToSlot, slotStamp } from '../systems/save';
import { closeAllPanels } from './panels';

const SLOTS: { key: string; label: string }[] = [
  { key: 'auto', label: '自动存档' },
  { key: 'manual1', label: '手动档 1' },
  { key: 'manual2', label: '手动档 2' },
  { key: 'manual3', label: '手动档 3' },
];

const modalEl = document.getElementById('saveModal') as HTMLElement;

function fmtStamp(iso: string | null): string {
  if (!iso) return '暂无存档';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '暂无存档';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) +
    ' ' + d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function refreshSlots(): void {
  const list = document.getElementById('slotList') as HTMLElement;
  list.innerHTML = SLOTS.map(
    (s) =>
      '<div class="slotRow">' +
      '<span class="slotName">' + s.label + '</span>' +
      '<span class="slotStamp">' + fmtStamp(slotStamp(s.key)) + '</span>' +
      '<button class="sbtn" data-slot="' + s.key + '" data-act="save">保存</button>' +
      '<button class="sbtn" data-slot="' + s.key + '" data-act="load">读取</button>' +
      '</div>',
  ).join('');
}

export function initSaveUI(): void {
  const btn = document.getElementById('saveBtn') as HTMLElement;
  btn.addEventListener('click', () => {
    closeAllPanels();
    refreshSlots();
    modalEl.style.display = 'flex';
  });

  modalEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'saveModal') {
      modalEl.style.display = 'none';
      return;
    }
    const b = t.closest('.sbtn') as HTMLElement | null;
    if (!b) return;
    const slot = b.dataset.slot as string;
    if (b.dataset.act === 'save') {
      if (saveToAndNotify(slot)) refreshSlots();
    } else {
      if (!slotStamp(slot)) {
        logMsg('该槽位暂无存档');
        refreshSlots();
        return;
      }
      loadRequest(slot);
    }
  });

  (document.getElementById('saveExport') as HTMLElement).addEventListener('click', () => {
    exportSave();
  });

  const fileInput = document.getElementById('saveImportFile') as HTMLInputElement;
  (document.getElementById('saveImport') as HTMLElement).addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    importSave(f, (ok, msg) => {
      logMsg(msg);
      if (ok) setTimeout(() => location.reload(), 900);
    });
    fileInput.value = '';
  });

  (document.getElementById('saveClose') as HTMLElement).addEventListener('click', () => {
    modalEl.style.display = 'none';
  });
}

function saveToAndNotify(slot: string): boolean {
  const ok = saveToSlot(slot);
  logMsg(ok ? '已保存到「' + (SLOTS.find((s) => s.key === slot)?.label ?? slot) + '」' : '保存失败（浏览器存储不可用）');
  return ok;
}
