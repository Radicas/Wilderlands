/**
 * 动态价格自检：编译 src/systems/trade.ts（纯函数 + 状态）为单文件 ESM 后断言。
 * 由 scripts/regress.sh 调用；价格公式改动时必须同步更新本文件用例。
 * 注意：trade.ts import state（含 three），bundle 后仍无 DOM 依赖，可被 node 执行。
 */
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const outDir = mkdtempSync(join(tmpdir(), 'wl-price-'));
const outFile = join(outDir, 'trade.mjs');

execSync(
  `npx esbuild src/systems/trade.ts --bundle --format=esm --outfile="${outFile}"`,
  { cwd: root, stdio: 'pipe' },
);

const { buyPrice, recordSold, recoverTrade } = await import(outFile);
const { soldToday } = await import(outFile);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('用例：木材收购价（基准 2，每 4 个 -1，保底 1）');
check('卖 0 → 2 金', buyPrice('wood', 0) === 2);
check('卖 3 → 2 金', buyPrice('wood', 3) === 2);
check('卖 4 → 1 金', buyPrice('wood', 4) === 1);
check('卖 10 → 1 金（保底）', buyPrice('wood', 10) === 1);

console.log('用例：石头收购价（同木材）');
check('卖 0 → 2 金', buyPrice('stone', 0) === 2);
check('卖 7 → 1 金', buyPrice('stone', 7) === 1);

console.log('用例：食物收购价（基准 3，每 3 个 -1，保底 1）');
check('卖 0 → 3 金', buyPrice('food', 0) === 3);
check('卖 2 → 3 金', buyPrice('food', 2) === 3);
check('卖 3 → 2 金', buyPrice('food', 3) === 2);
check('卖 6 → 1 金', buyPrice('food', 6) === 1);
check('卖 20 → 1 金（保底）', buyPrice('food', 20) === 1);

console.log('用例：recordSold 返回卖前价并累计');
// 重置成交量
soldToday.wood = 0;
const p1 = recordSold('wood');
check('第 1 个 2 金', p1 === 2 && soldToday.wood === 1);
// 再卖 4 个：第 5 个（卖前 sold=4）起跌到 1 金
const p5 = (() => { let last; for (let i = 0; i < 4; i++) last = recordSold('wood'); return last; })();
check('第 5 个 1 金（卖满 4 个后）', p5 === 1 && soldToday.wood === 5);

console.log('用例：隔日回升（成交量 ×0.3）');
soldToday.wood = 4;
recoverTrade();
check('4 → 1（floor 4×0.3）', soldToday.wood === 1);
check('回升后价回到 2', buyPrice('wood', soldToday.wood) === 2);
soldToday.food = 6;
recoverTrade();
check('食物 6 → 1（floor 6×0.3）', soldToday.food === 1);
check('食物价回升到 3', buyPrice('food', soldToday.food) === 3);

if (fail > 0) {
  console.error(`价格自检失败：${fail} 项未通过`);
  process.exit(1);
}
console.log(`价格自检通过：${pass} 项`);
