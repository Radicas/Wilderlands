/**
 * 存档迁移自检：编译 src/systems/migrate.ts（纯函数）为 ESM，再执行断言。
 * 由 scripts/regress.sh 调用；迁移逻辑改动时必须同步更新本文件用例。
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(import.meta.dirname, '..');
const outDir = mkdtempSync(join(tmpdir(), 'wl-mig-'));
const outFile = join(outDir, 'migrate.mjs');

// esbuild 打包为单文件 ESM（vite 自带 esbuild；migrate 只依赖 type）
execSync(
  `npx esbuild src/systems/migrate.ts --bundle --format=esm --outfile="${outFile}"`,
  { cwd: root, stdio: 'pipe' },
);

const { migrateSave, SAVE_VERSION } = await import(outFile);

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

// ---- 用例 ----
console.log('用例：v1 旧档 → 链式升级到 v5（补默认技能/船/属性/性格情绪）');
const v1 = {
  version: 1,
  savedAt: '2026-10-01T00:00:00.000Z',
  gold: 12,
  time: 0.3,
  units: [
    { name: 'A', x: 0, z: 0, hp: 80, hunger: 50, hasSpear: false, atkDmg: 5, inv: { wood: 3 } },
  ],
  buildings: [],
  tiles: [],
  wanderer: null,
};
const m1 = migrateSave(v1);
check('迁移成功', m1 !== null);
check('版本升至 v5', m1?.version === 5 && SAVE_VERSION === 5);
check('队员补默认技能', JSON.stringify(m1?.units[0].skills) === '{"gather":0,"combat":0,"farm":0}');
check('其余字段保留', m1?.gold === 12 && m1?.units[0].hp === 80);

console.log('用例：v2 旧档 → v5（保留已有技能）');
const v2 = {
  version: 2,
  savedAt: '2026-10-22T00:00:00.000Z',
  gold: 33,
  time: 0.5,
  units: [
    { name: 'A', x: 1, z: 1, hp: 90, hunger: 60, hasSpear: true, atkDmg: 8, inv: {}, skills: { gather: 3, combat: 1, farm: 0 } },
  ],
  buildings: [],
  tiles: [],
  wanderer: null,
};
const m2 = migrateSave(v2);
check('v2 升 v5 成功', m2?.version === 5 && m2?.units[0].skills.gather === 3);
check('v2 补默认船进度', JSON.stringify(m2?.ship) === '{"wood":0,"stone":0,"done":false}');
check('v2 其余字段保留', m2?.gold === 33);

console.log('用例：v4 旧档 → v5（补性格与情绪，spec 011）');
const v4 = {
  ...v2, version: 4, ship: { wood: 30, stone: 20, done: true },
  units: [{ ...v2.units[0], attrs: { stamina: 88, staminaXp: 5, vitalityXp: 0, atkXp: 3, defXp: 0 } }],
};
const m4 = migrateSave(v4);
check('v4 升 v5 成功', m4?.version === 5 && m4?.ship.wood === 30 && m4?.ship.done === true);
check('v4 属性保留', JSON.stringify(m4?.units[0].attrs) === '{"stamina":88,"staminaXp":5,"vitalityXp":0,"atkXp":3,"defXp":0}');
check('v4 补性格三维与情绪', m4?.units[0].personality && typeof m4.units[0].personality.combat === 'string'
  && typeof m4.units[0].personality.work === 'string' && typeof m4.units[0].personality.trait === 'string'
  && m4.units[0].mood === 'neutral');

console.log('用例：v5 当前档透传（已有性格不重掷）');
const v5 = {
  ...v4, version: 5,
  units: [{ ...v4.units[0], personality: { combat: 'cautious', work: 'hardworking', trait: 'glutton' }, mood: 'irritable' }],
};
const m5 = migrateSave(v5);
check('v5 透传成功', m5?.version === 5 && m5?.ship.done === true);
check('v5 性格原样保留（不重掷）', m5?.units[0].personality.combat === 'cautious' && m5?.units[0].mood === 'irritable');

console.log('用例：v3 旧档 → v5（补属性默认值与性格）');
const v3 = { ...v2, version: 3, ship: { wood: 30, stone: 20, done: true } };
const m3 = migrateSave(v3);
check('v3 升 v5 成功', m3?.version === 5 && m3?.ship.wood === 30 && m3?.ship.done === true);
check('v3 补默认属性', JSON.stringify(m3?.units[0].attrs) === '{"stamina":100,"staminaXp":0,"vitalityXp":0,"atkXp":0,"defXp":0}');
check('v3 性格补齐', m3?.units[0].personality && m3?.units[0].mood === 'neutral');

console.log('用例：v1 经 v2/v3/v4 链式升级到 v5');
const m1b = migrateSave(v1);
check('v1→v5 成功', m1b?.version === 5);
check('v1 补技能与船与属性与性格', JSON.stringify(m1b?.units[0].skills) === '{"gather":0,"combat":0,"farm":0}' && JSON.stringify(m1b?.ship) === '{"wood":0,"stone":0,"done":false}' && JSON.stringify(m1b?.units[0].attrs) === '{"stamina":100,"staminaXp":0,"vitalityXp":0,"atkXp":0,"defXp":0}' && !!m1b?.units[0].personality);

console.log('用例：v2 当前档部分技能缺失 → 迁移（运行时 ??0 兜底，不炸）');
const v2b = JSON.parse(JSON.stringify(v2));
v2b.units[0].skills = { gather: 5 };
const m2b = migrateSave(v2b);
check('透传成功且保留已有技能', m2b !== null && m2b.units[0].skills.gather === 5);

console.log('用例：非法输入拒绝');
check('null 拒绝', migrateSave(null) === null);
check('字符串拒绝', migrateSave('hello') === null);
check('版本不符拒绝', migrateSave({ ...v1, version: 99 }) === null);
check('缺 units 拒绝', migrateSave({ version: 1, gold: 1 }) === null);

if (fail > 0) {
  console.error(`迁移自检失败：${fail} 项未通过`);
  process.exit(1);
}
console.log(`迁移自检通过：${pass} 项`);
