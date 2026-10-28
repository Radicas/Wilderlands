#!/usr/bin/env bash
# Wilderlands · 自动回归（并行版）
# 用法：bash scripts/regress.sh   （在仓库根目录运行）
# 串行：tsc → 构建 → 产物断言；并行：白盒 5 项 + 冒烟 + 黑盒（组内再并发 4）+ OpenSpec 规格 lint
# 可调：WL_TURBO（黑盒时间倍率，默认 8）、WL_CONCURRENCY（黑盒并发组数，默认 4）
set -uo pipefail
cd "$(dirname "$0")/.."
T0=$(date +%s)
FAILS=0

say() { echo "== $* =="; }

say "[1] tsc --noEmit"
if ! npx tsc --noEmit; then echo "FAIL: 类型检查"; exit 1; fi
echo OK

say "[2] vite build + 产物断言"
if ! npm run build >/tmp/wl-build.log 2>&1; then echo "FAIL: 构建，见 /tmp/wl-build.log"; tail -20 /tmp/wl-build.log; exit 1; fi
JS=$(ls dist/assets/*.js 2>/dev/null | head -1)
if [ ! -f dist/index.html ] || [ -z "$JS" ]; then echo "FAIL: dist 产物缺失"; exit 1; fi
echo "OK ($JS)"

say "[3] 并行自检（白盒×5 + 冒烟 + 黑盒）"
node scripts/migrate-check.mjs >/tmp/wl-mig.log 2>&1 &
PID1=$!
node scripts/skills-check.mjs  >/tmp/wl-skills.log 2>&1 &
PID2=$!
node scripts/price-check.mjs   >/tmp/wl-price.log 2>&1 &
PID3=$!
node scripts/ship-check.mjs    >/tmp/wl-ship.log 2>&1 &
PID4=$!
node scripts/sim-run.mjs       >/tmp/wl-sim.log 2>&1 &
PID5=$!
node scripts/smoke.mjs         >/tmp/wl-smoke.log 2>&1 &
PID6=$!
node scripts/e2e-blackbox.mjs  >/tmp/wl-bb.log 2>&1 &
PID7=$!
OPENSPEC_TELEMETRY=0 npx openspec validate --all --strict >/tmp/wl-osx.log 2>&1 &
PID8=$!

collect() {
  local name=$1 pid=$2 log=$3 lines=${4:-25}
  if wait "$pid"; then
    echo "OK: $name"
  else
    echo "FAIL: ${name} — 日志 ${log}"
    tail -n "$lines" "$log"
    FAILS=$((FAILS + 1))
  fi
}
collect "存档迁移自检" $PID1 /tmp/wl-mig.log
collect "技能数值自检" $PID2 /tmp/wl-skills.log
collect "动态价格自检" $PID3 /tmp/wl-price.log
collect "主线修船自检" $PID4 /tmp/wl-ship.log
collect "headless 模拟自检" $PID5 /tmp/wl-sim.log 30
collect "冒烟测试" $PID6 /tmp/wl-smoke.log 30
collect "黑盒测试" $PID7 /tmp/wl-bb.log 45
collect "OpenSpec 规格 lint" $PID8 /tmp/wl-osx.log 15

echo ""
echo "== 回归总耗时 $(( $(date +%s) - T0 ))s =="
if [ "$FAILS" -gt 0 ]; then echo "== 回归失败：$FAILS 个环节未通过 =="; exit 1; fi
echo "== 回归全部通过 =="
