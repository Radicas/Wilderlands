/**
 * 技能数值自检：编译 src/systems/skills.ts（纯函数，无 three 依赖）为 ESM 后断言。
 * 由 scripts/regress.sh 调用；技能公式改动时必须同步更新本文件用例。
 */
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const outDir = mkdtempSync(join(tmpdir(), 'wl-skill-'));
const outFile = join(outDir, 'skills.mjs');

// esbuild 打包为单文件 ESM（vite 自带 esbuild；skills 无 three 依赖）
execSync(
  `npx esbuild src/systems/skills.ts --bundle --format=esm --outfile="${outFile}"`,
  { cwd: root, stdio: 'pipe' },
);

const { skillLevel, capacityBonus, atkBonus, harvestBonus, emptySkills } = await import(outFile);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('用例：经验阈值 → 等级（[3,8,15,25,40] 封顶 Lv5）');
check('xp0 → Lv0', skillLevel(0) === 0);
check('xp2 → Lv0', skillLevel(2) === 0);
check('xp3 → Lv1', skillLevel(3) === 1);
check('xp7 → Lv1', skillLevel(7) === 1);
check('xp8 → Lv2', skillLevel(8) === 2);
check('xp15 → Lv3', skillLevel(15) === 3);
check('xp25 → Lv4', skillLevel(25) === 4);
check('xp40 → Lv5', skillLevel(40) === 5);
check('xp99 → Lv5 封顶', skillLevel(99) === 5);

console.log('用例：采集 → 负重上限 +4/级');
check('gather0 → +0', capacityBonus({ skills: { gather: 0, combat: 0, farm: 0 } }) === 0);
check('gather3xp → +4', capacityBonus({ skills: { gather: 3, combat: 0, farm: 0 } }) === 4);
check('gather8xp → +8', capacityBonus({ skills: { gather: 8, combat: 0, farm: 0 } }) === 8);
check('gather40xp → +20', capacityBonus({ skills: { gather: 40, combat: 0, farm: 0 } }) === 20);

console.log('用例：战斗 → 攻击 +1/级（封顶 +4）');
check('combat0 → +0', atkBonus({ skills: { gather: 0, combat: 0, farm: 0 } }) === 0);
check('combat3xp → +1', atkBonus({ skills: { gather: 0, combat: 3, farm: 0 } }) === 1);
check('combat8xp → +2', atkBonus({ skills: { gather: 0, combat: 8, farm: 0 } }) === 2);
check('combat15xp → +3', atkBonus({ skills: { gather: 0, combat: 15, farm: 0 } }) === 3);
check('combat25xp → +4', atkBonus({ skills: { gather: 0, combat: 25, farm: 0 } }) === 4);
check('combat40xp → +4 封顶', atkBonus({ skills: { gather: 0, combat: 40, farm: 0 } }) === 4);

console.log('用例：种田 → 收获 +1/级（封顶 +2）');
check('farm0 → +0', harvestBonus({ skills: { gather: 0, combat: 0, farm: 0 } }) === 0);
check('farm3xp → +1', harvestBonus({ skills: { gather: 0, combat: 0, farm: 3 } }) === 1);
check('farm8xp → +2', harvestBonus({ skills: { gather: 0, combat: 0, farm: 8 } }) === 2);
check('farm40xp → +2 封顶', harvestBonus({ skills: { gather: 0, combat: 0, farm: 40 } }) === 2);

console.log('用例：emptySkills');
check('空技能全 0', JSON.stringify(emptySkills()) === '{"gather":0,"combat":0,"farm":0}');

if (fail > 0) {
  console.error(`技能自检失败：${fail} 项未通过`);
  process.exit(1);
}
console.log(`技能自检通过：${pass} 项`);
