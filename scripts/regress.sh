#!/usr/bin/env bash
# Wilderlands · 自动回归
# 用法：bash scripts/regress.sh   （在仓库根目录运行）
# 覆盖：类型检查 → 生产构建 → 产物断言 → 存档迁移自检 → 技能/价格/修船/headless 模拟自检 → 冒烟 → 黑盒
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== [1/10] tsc --noEmit =="
npx tsc --noEmit
echo "OK"

echo "== [2/10] vite build =="
npm run build >/tmp/wl-build.log 2>&1
tail -3 /tmp/wl-build.log
echo "OK"

echo "== [3/10] 产物断言 =="
test -f dist/index.html || { echo "FAIL: dist/index.html 缺失"; exit 1; }
JS=$(ls dist/assets/*.js 2>/dev/null | head -1)
test -n "$JS" || { echo "FAIL: dist JS 产物缺失"; exit 1; }
SIZE=$(stat -f%z "$JS")
echo "JS: $JS ($SIZE bytes)"
echo "OK"

echo "== [4/10] 存档迁移自检 =="
node scripts/migrate-check.mjs
echo "OK"

echo "== [5/10] 技能数值自检 =="
node scripts/skills-check.mjs
echo "OK"

echo "== [6/10] 动态价格自检 =="
node scripts/price-check.mjs
echo "OK"

echo "== [7/10] 主线修船自检 =="
node scripts/ship-check.mjs
echo "OK"

echo "== [8/10] headless 模拟自检（剥离图形，node 跑整局） =="
node scripts/sim-run.mjs >/tmp/wl-sim.log 2>&1 || { echo "FAIL: sim 断言未通过，见 /tmp/wl-sim.log"; tail -20 /tmp/wl-sim.log; exit 1; }
grep "全部断言通过" /tmp/wl-sim.log
echo "OK"

echo "== [9/10] 冒烟测试（headless Chromium，dist 产物） =="
node scripts/smoke.mjs || { echo "FAIL: 冒烟未通过"; exit 1; }
echo "OK"

echo "== [10/10] 黑盒测试（headless Chromium，19 组 104 项，约 20 分钟） =="
node scripts/e2e-blackbox.mjs || { echo "FAIL: 黑盒未通过"; exit 1; }
echo "OK"

echo ""
echo "== 回归全部通过 =="
