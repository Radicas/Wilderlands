/**
 * Wilderlands · 面板互斥（UI 辅助）
 * 打开任一系统面板（交易/修船/存档/背包转移）时关闭其他面板，
 * ESC 一键全关。避免多面板叠开互相遮挡、点击互相干扰。
 */
export function closeAllPanels(): void {
  const ids = ['trade', 'shipPanel', 'saveModal', 'invPicker'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
}
