/**
 * Wilderlands · 游戏日志（纯函数，无 three 依赖，可被 node 直接测试）
 */
export let logMsg: (s: string) => void = (s: string) => console.log('[log]', s);

export function setLogHandler(fn: (s: string) => void): void {
  logMsg = fn;
}
