# Proposal

## Why

森林有年轮、有倒法、有声音之后，地图上仍然**只有玩家会动**——150 棵树静立，狼只在战斗时出现。生活感的最后一块拼图是"这个世界不围着玩家转"：林缘有兔子惊跳，溪边有鹿群低头吃草、你走近它们才不紧不慢地跑开，天空偶尔有鸟群掠过并伴随啁啾。这些动物**纯装饰**：不可交互、不进战斗、不进存档、不进 sim——正如声音系统证明的：表现层的生命力不需要污染模拟轨。

## What Changes

- **ADDED 兔群（约 6 只）**：狼四足模型的 0.4 倍缩小版，散布林缘；**跳跃式游走**（hop：抛物线弹跳 + 停顿张望），玩家 6m 内惊跳窜远
- **ADDED 鹿群（3-4 只一组）**：高挑四足 + 角，缓速吃草（低头周期），玩家 9m 内**整体缓慢避离**（跑开方向背离，速度渐升）
- **ADDED 鸟群掠空（编队 5 只）**：周期性横穿天空（真实时间排程，与 sound 的 bird 鸣叫同源调度——**啁啾时鸟群恰好掠过**）
- **ADDED 生活感开关无关**：reduced-motion 下静止不做弹跳（保留站位）
- 纯表现层红线：不注册拾取（`regInter` 零触碰）、不进 `targets`/战斗/存档/sim 镜像；`SAVE_VERSION` 与黑盒既有口径零影响
- 新夹具 `wildlifeStats()`（数量/最近鹿避离距离/兔 hop 峰值），G26 断言行为不改数值

## Impact

- **New capability**: `decor-wildlife`
- Affected code: 新文件 `src/systems/wildlife.ts`（或 entities/decorAnimals.ts）；`src/main.ts`（loop 接线 + 夹具）；`src/core/sound.ts`（bird 排程回调钩子）；`index.html`/材质复用 PALETTE
- Affected tests: G26 新增 ~6 项；sim/smoke 零改动
