/**
 * 主线修船自检：编译 src/systems/ship.ts 为单文件 ESM 后断言完成阈值与投入逻辑。
 * 由 scripts/regress.sh 调用；修船数值改动时必须同步更新本文件用例。
 */
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const outDir = mkdtempSync(join(tmpdir(), 'wl-ship-'));
const outFile = join(outDir, 'ship.mjs');

execSync(
  `npx esbuild src/systems/ship.ts --bundle --format=esm --outfile="${outFile}"`,
  { cwd: root, stdio: 'pipe' },
);

const { shipReady, donateToShip, completeShip } = await import(outFile);
const { ship } = await import(outFile);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('用例：完成阈值（木材 30 / 石头 20）');
check('未集齐 → false', shipReady(0, 0) === false);
check('木材满石头缺 → false', shipReady(30, 10) === false);
check('石头满木材缺 → false', shipReady(10, 20) === false);
check('刚集齐 → true', shipReady(30, 20) === true);
check('超出 → true', shipReady(99, 99) === true);

console.log('用例：投入逻辑（不超需求、封顶）');
ship.wood = 0; ship.stone = 0; ship.done = false;
check('投木材 10 → 10', donateToShip('wood', 10) === true && ship.wood === 10);
check('投木材超额 → 封顶 30', donateToShip('wood', 100) === true && ship.wood === 30);
check('投石头 20 → 20', donateToShip('stone', 20) === true && ship.stone === 20);

console.log('用例：完成后拒绝投入');
completeShip();
check('done 后拒投', donateToShip('wood', 10) === false && ship.wood === 30);

if (fail > 0) {
  console.error(`修船自检失败：${fail} 项未通过`);
  process.exit(1);
}
console.log(`修船自检通过：${pass} 项`);
