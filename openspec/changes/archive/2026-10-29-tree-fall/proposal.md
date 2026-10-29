# Proposal

## Why

forest-life 之后，砍树的"倒下瞬间"仍是全游戏最出戏的一幕：成树被砍后**原地缩小沉入地下**（gather-feedback 时期的下沉补间），像魔术道具消失而非一棵倒下的树。玩家反馈"砍树没有砍树的实感"。树有树种有重量了（松/橡/桦），倒法却仍是统一的"蒸发"。本轮把死亡补间改为**定向倒地**：以树根为轴倾覆，方向背离伐木者，重量决定倒速——橡树又沉又慢砸地 Screen 一震，白桦轻巧快倒。同步引入**砸地镜头微震**与落地重音，与 sound-system 的倒木沙沙首尾呼应。

## What Changes

- **MODIFIED 树木消亡补间**：`tickDeathAnims` 树分支从"缩放沉地"改为**树根轴心定向倾覆**（pivot 旋转至近 90°，尾段微缩出画）；终态不变（地下 + 拾取失效 + 空窗/生长语义零改动）
- **ADDED 倒向 = 背离伐木者**：`_finishGather` 写入 `tree.fallYaw`（伐木者→树反向）；其他来源缺省随机向。纯表现字段，**不入存档**（树本就不存盘），无版本影响
- **ADDED 按树种重量**：`TREES` 表增 `fallDur`：松 0.55s / 橡 0.75s / 桦 0.42s
- **ADDED 砸地反馈**：落地时刻——镜头微震（`shakeCamera`，幅度按重量，0.18s 衰减，updateCamera 每帧重设故偏移自愈）+ 重音（复用 sfx `down`）；倒木沙沙（thud）仍在起倒时刻
- **ADDED 夹具 `fallInfo()`**：返回进行中消亡样本（species/t/dur/yaw）+ 当前震幅——断言倒速按树种、方向背离、终态照常
- gather-feedback 的"下沉缩小"场景被本 change 取代（该 change 未归档，delta 不回改；以 `forest-fall` 新 capability 记录倒地动画，测试口径 G21 只断计数落账不受影响）
- sim 轨无镜像义务（倒法是纯表现）；`sim-run` 零动

## Impact

- **Affected capabilities**: 新增 `forest-fall`；隐式取代 gather-feedback 的消亡动画要求（未归档 change 不回改，见上）
- Affected code: `src/core/world.ts`（DyingTree 倾覆矩阵链/树种 dur/落地回调）、`src/config.ts`（TREES.fallDur）、`src/types.ts`（TreeEnt.fallYaw）、`src/entities/unit.ts`（定向写入）、`src/core/renderer.ts`（shakeCamera+震Tick）、`src/main.ts`（loop 接线+fallInfo 夹具）
- Affected tests: `scripts/e2e-blackbox.mjs` 新增 G25（6 项）；G21/G23 回归复用；README/DESIGN 文档行
