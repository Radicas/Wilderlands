# Tasks

## 1. 声音内核
- [x] 1.1 新建 `src/core/sound.ts`：懒建 ctx/主增益/noise buffer/包络工具/`sfx(name)` 音色表（chop·mine·pick·pickup·hurt·down·bite·thud·build·repair·win·coin·ref·yes·no·tick·bird·cricket·howl）/0.2s 真实时间节流（吞声不吞 ring）/`setBed`/`toggleMuted`/`soundStats`；模块顶层零副作用，`unlockSound` try/catch 全包裹
- [x] 1.2 `config.ts` 增 `SOUND` 参数表（master 0.5、hitThrottle 0.2、birdGap/cricketGap/howlGap 区间）
- [x] 1.3 `main.ts` 挂 pointerdown once 解锁 + stepGame 尾部 `soundTick(dt)`（床层点缀排程，表现层 Math.random）

## 2. 一次性音效挂点（前端专属文件，~12 处）
- [x] 2.1 `entities/unit.ts`：工作节拍挥击（workDur/3 跨越按 kind 选 chop/mine/pick）、`_finishGather` pickup、背包满 ref、takeDamage hurt、倒地 down
- [x] 2.2 `systems/combat.ts`：狼咬 bite、狼死亡 down；`core/world.ts` applyTreeVisible(false) thud
- [x] 2.3 `systems/build.ts` build、`ship.ts` repair+win、`trade.ts` coin
- [x] 2.4 `systems/commands.ts`：招募成交/拒绝 yes/no、幼树免砍 ref、右键选中 tick 轻点

## 3. 环境床
- [x] 3.1 `daynight.ts` isNight 翻转沿调 `setBed`；床层双轨（风 noise / 鸟·虫点缀排程）交叉渐变 ≤3s
- [x] 3.2 夜间 howl 20–60s 随机点缀（禁用 sim Rng）

## 4. 静音与持久化
- [x] 4.1 `ui/hud.ts` 静音按钮 + `core/input.ts` M 热键（先 grep 确认空闲），按钮态与 muted 同步
- [x] 4.2 `systems/save.ts` payload 增可选 `muted`，读档应用；`migrate.ts` 零改动（SAVE_VERSION 保持 5），导出档缺字段默认非静音

## 5. 夹具与断言
- [x] 5.1 `main.ts` 夹具 `soundStats()`（unlocked/muted/bed/ring/counts）
- [x] 5.2 e2e 新增 G24 声音系统：首击解锁→砍树序列出现 chop+pickup→refuse 挂点（幼树/满包）→昼夜沿 bed 翻转→howl 仅夜间→M 静音后 counts 仍增且 bedGain=0→存读档静音保持；console 零错误
- [x] 5.3 回归批 `WL_ONLY=G3,G4,G16,G17,G20,G21,G22,G23,G24` 全绿 + sim 169 + 冒烟 + tsc/build/validate

## 6. 文档与提交
- [x] 6.1 README（23→24 组、soundStats 夹具行）+ DESIGN 声音行
- [x] 6.2 三提交（feat/test/docs），归档留待用户指令
