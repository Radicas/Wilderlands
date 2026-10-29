# Design

## Context
狼四足模型（capsule 腿 + 髋 pivot + calf 链）是现成模板；`groundHeightAt(x,z)` 贴地；树分布 `targets.trees` 供林缘采样；sound 的 bird 由 `soundTick(realDt)` 排程（真实时间，performance.now 自差分）。约束：纯表现红线（sound D10 同款）、5fps 饥饿帧下仍要动（一切动画走 realDt）。

## Decisions
- **W1 模块形态**：新文件 `src/systems/wildlife.ts`——`initWildlife()`（世界构建后调用，建 Group 挂 scene）+ `wildlifeTick(realDt)`（main loop 接线，与 soundTick 同段）。零 sim import（eslint 边界天然：systems/ 已有前端专属模块）。
- **W2 几何复用**：兔/鹿均取狼拓扑参数化缩放（兔 0.4×灰白、鹿 1.35×鹿棕 + 两角线段 Mesh）；腿摆/尾摆沿用 unit.ts 的 sin 相位写法但**不实例化 PioneerUnit**（无 hp/inv/task——独立轻量 `CritterEnt {mesh,kind,pos,vel,state,t}`）。拾取零注册（不 regInter ⇒ commandAt 物理不可达）。
- **W3 行为机**：兔=hop 状态机（idle 1-2.5s → hop 0.4s 抛物线 y=sin(πt)×0.28 → 随机朝向）；惊跳=玩家 6m 内 hop 幅度×2 + 方向锁定背离 + 冷却 4s。鹿=graze 周期（低头 3s 头颈旋转 → 抬头 2s → 挪步 1m）；避离=玩家 9m 内进入 flee（walk 1.2 → trot 2.4 渐升，方向背离玩家 + 群体聚合半径 6m 跟随领头）。鸟=一条编排航线（高度 9-12m，从地图边缘进、对侧出，周期 25-60s 随机），**与 sound bird 同排程器**：wildlifeTick 维护 flyNext，触发时同时 `skyActive=true` + 调用 sound 侧的 birdAt 钩子（sound.ts 导出 `onBirdCall(cb)`，回调保持单向：wildlife → sound 查询窗，sound 不 import wildlife）。
- **W4 数量与出生地**：兔 6（距最近树 ≤4m 的随机树位旁）、鹿 4（开阔地：距树 >3m 采样）、鸟 1 编队 5 只（Group 内相对偏移阵形）。initWildlife 用 Math.random（表现层），世界 reload 即重生（无存档 ⇒ 天然一致）。
- **W5 reduced-motion**：`prefers-reduced-motion` 或 `?reduced=1`（沿用现有判定）⇒ wildlifeTick 直接 return（保持出生站位与姿态，不动不消失）。
- **W6 性能**：合计 ≤15 个低面 Group、tick 为纯数学（无 raycast 无 DOM）；150 树场景实测帧预算忽略不计。
- **W7 夹具**：`wildlifeStats()` → `{ rabbits, deer, birds, nearestDeer: {d, fleeing}, maxHop, skyActive }`（nearestDeer.d 为玩家→最近鹿距离；maxHop 为近 10s 内最大 y 峰值——供惊跳断言）。
- **W8 昼夜**：兔/鹿夜间归巢静止（flee 仍可触发）——夜行不做，避免与狼出没抢戏；鸟只白天掠空（复用 timeOfDay.isNight 判定，读不写）。

## Risks
- **狼误咬装饰鹿**（ wolves 的 target 仅 players，regInter wolf 索敌走 players 列表）——已核 combat 不索敌非注册对象 ⇒ 零风险，G26 场景外回归。
- **flee 把鹿赶进树堆卡位**：移动后 `groundHeightAt` 贴地 + 撞树滑散（距树 <1m 时切向速度）——简单推挤不做寻路。
- **sound 回调耦合方向**：wildlife import sound 的 `onBirdCall` 单向；sound 保持零新增依赖（红线自查 grep）。
