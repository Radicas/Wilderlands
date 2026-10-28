# v0.5 · headless 模拟层（剥离图形，纯后台跑）规格

> 版本：v0.5-S6 · 状态：方案（2026-10-22）
> 目标：**完全剥离图形，让游戏核心逻辑在 node 中完整运行**——无 three 渲染、无 DOM、无 UI。前端暂时不动；本阶段交付"纯后台可跑的游戏" + 事件流 + 状态快照。

## 1. 为什么

- 用户要求：下一阶段完全剥离图形，把游戏运行起来（纯后台）。
- 价值：整局模拟可测（比单模块自检强一个量级）；无 UI 也能跑、能回放；未来联网时这套模拟层直接做服务器权威（此前架构探讨的"服务器权威拐点"，现在铺路）。
- 现状：已有 `src/systems/{inventory,skills,trade,ship,migrate}.ts` 纯逻辑可 node 跑（回归自检 65 项断言）；`daynight/farm` 逻辑与表现混合；**unit.ts 是"状态+表现"深耦合**；`world.ts` 的纯函数（groundHeightAt）与 three 表现共存；`renderer.ts` 顶层执行 `new WebGLRenderer()`（node import 必炸）——逻辑层绝不能 import 表现模块。

## 2. 架构（单向依赖：sim 纯 ← 前端表现）

```
src/sim/rng.ts      确定性随机（LCG，可复现）
src/sim/terrain.ts  纯地形：noise2D / groundHeightAt / TILE / GRID（从 world.ts 提取，无状态）
src/sim/types.ts    SimWorld / SimUnit / SimTile / SimTree…（纯数据，无 three/DOM）
src/sim/unit.ts     SimUnit 纯逻辑类：moveToward(平面) / lookAtTarget / takeDamage / 倒地恢复 / 饥饿 / 任务状态机与结算
src/sim/world.ts    createSimWorld()（初始化）+ simTick(world, dt, events)（主循环：时间/狼AI/重生/农场/价格/修船）
scripts/sim-run.mjs node 入口：建世界→下发命令→跑 N 秒→打印事件流+最终快照
```

- **复用已纯的 systems**：sim 直接 import `src/systems/{inventory,skills,trade,ship}.ts`（node 自检已证明纯）；farm 的数值推进、daynight 的时间推进在 sim 内以纯函数重写（规则对照下方表）。
- **前端不动**：entities/unit.ts、combat.ts、world.ts 保持现状，仅 world.ts 的地形函数改为从 `sim/terrain.ts` re-export（消除地形双份）。
- **过渡性双份**：sim/unit.ts 与 entities/unit.ts 的任务规则暂时并存，以**规则对照表**保证一致；下一阶段（spec 009）前端改用 sim 世界渲染，消除双份。

## 3. 规则对照表（sim 实现必须与此一致，防漂移）

| 规则 | 数值/行为 | 来源 |
| --- | --- | --- |
| 到达判定 | 平面距离 ≤ 0.2；位移 dir.y=0；y 跟随地面 | entities/unit.ts moveToward（已修 2D） |
| 攻击射程 | 1.9（站位 0.3）| entities/unit.ts attack 分支 |
| 狼攻击 | 射程 1.7、CD 1s、伤害 CFG.wolfDmg | combat.ts |
| 狼侦测 | 白天 11 / 夜 18；夜速 ×1.15 | combat.ts |
| 狼游荡 | 半径 3+rand4、间隔 2+rand3、到位 0.5 | combat.ts |
| 狼刷新 | 间隔 CFG.wolfSpawn（夜 ×0.55）、最大 wolfMax、园区外 22..30 | combat.ts |
| 资源重生 | 树 45s / 石 90s(hp3) / 浆果 CFG.berryRespawn / 流浪者 respawn | combat.ts updateWorld |
| 饥饿 | player：hungerRate/s；≤0 每秒 1 伤害 | entities/unit.ts update |
| 倒地 | downRecover 秒后 hp=50 苏醒 | entities/unit.ts update |
| 采集结算 | 树 +2 木（背包满不发）石 +1 石(hp-1) 浆果 +1 熟田 +1(+bonus) | entities/unit.ts _finishGather |
| 种田生长 | home 快 / wild 慢；0.45→生长期；1.0→成熟 | farm.ts updateFarms |
| 时间 | t 推进 1/CFG.daySeconds；t<prevT 跨日 recoverTrade；isNight=t≥0.5 | daynight.ts |
| 价格 | recordSold 逐笔跌价；recoverTrade 跨日回升 | systems/trade.ts（直接复用） |
| 修船 | donateToShip / shipReady / ship{wood,stone,done} | systems/ship.ts（直接复用） |
| 战斗击杀 | 玩家杀狼：food+2、combat+3、狼死 | entities/unit.ts takeDamage |

## 4. sim-run 验证场景（确定性，固定 rng 种子）

1. 初始化：3 玩家（罗恩 wood10 / 克莉 / 巴德，START_INV）+ 3 狼 + 树/石/浆果 + 地块 + 商摊 + 船；gold 20；t=0.1。
2. 空跑 10 秒：无事发生（idle 角色原地不动）、时间走、狼游荡。
3. `move 罗恩 (20,20)` → 走到后站定（验证平面到达，不再无限走）。
4. `gather 罗恩 树#0` → 走到 → 采集 +2 木（背包校验）。
5. `trade 克莉 商摊` → 走到 → workT 1.2 → 完成事件。
6. 设 t=0.55（夜晚）→ 狼追击玩家 → 玩家 hp 下降（战斗事件）。
7. `donate 罗恩 船 wood` → ship.wood +10。
8. 断言清单（见 §5）全部通过；打印事件流 + 最终快照。

## 5. 断言（sim-check，接入 regress.sh）

- A1 空跑 10s：时间 t 从 0.1 → 0.1+10/CFG.daySeconds；角色位置不变；狼数=3。
- A2 move 后：罗恩平面距离目标 ≤0.2 且 **task=null**（到达站定）；再跑 2s 位置不变（不再走）。
- A3 gather 树：罗恩 wood = 10+2；树 alive=false；respawn>0。
- A4 trade：克莉走到商摊（距离 ≤2.5+0.2）；trade 任务完成。
- A5 夜晚：某玩家 hp < 100（被狼咬）；事件流含"咬伤"。
- A6 donate：ship.wood=10。
- A7 全程事件流非空；最终快照 JSON 可打印。

## 6. 验证

- `npx tsc --noEmit`：sim 代码进编译，0 错误。
- `node scripts/sim-run.mjs`：事件流 + 快照 + 断言（退出码 0/1）。
- `bash scripts/regress.sh`：新增 sim-check（跑 sim-run 断言）后七步→八步全绿。
- 前端不改 → 现有 4173 预览不受影响（dist 重建后照常服务）。

## 7. 后续（不做）

- 前端接入 sim 世界渲染（spec 009，消除双份）；交互式 CLI（输入命令控制模拟）；模拟回放（事件流→重演）；联网服务器权威。
