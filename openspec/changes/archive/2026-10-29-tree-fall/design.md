# Design

## Context

`dyingTrees` 补间现为"缩放+下沉"（gather-feedback），rig/slot 寻址在 forest-life 已改造；`updateCamera()` 每帧 `setFromSpherical().add(target)` 全量重设相机位——震屏偏移无需显式复位（下帧覆盖即自愈）。约束：树不入存档；G21 只断"计数落账"口径；同帧点击纪律（sound/G23 教训）。

## Decisions

- **D1 倾覆矩阵链**：每帧 `M = T(p) · Ry(yaw) · Rx(θ) · T(−p) · M_orig`（对 trunk/crown 各自 M_orig 同链，世界轴心在树根 p）。θ = easeOutQuad(min(t/dur,1)) × (π/2 − 0.06)；尾段 15% 叠加 scale→0.82 收出画（避免 90° 完全躺平与地面穿插加重）。零新增几何。
- **D2 DyingTree 扩展**：`{tree, t, dur, yaw}`——`dur` 起倒时取 `TREES[species].fallDur` 快照（表值改动不影响进行中样本），`yaw` 取 `tree.fallYaw ?? Math.random()*2π`；原 `trunk/crown DeadTransform` 保留作 M_orig 源。tick 里 `setMatrixAt` 写合成结果，终态仍 `setInstanceUnder` 双件——**空窗/阶段机/拾取语义零改动**（spec 第三场景的落点）。
- **D3 倒向语义**：`_finishGather` 在 `mesh.visible=false` **之前**写 `tree.fallYaw = Math.atan2(t.p.x - this.pos.x, t.p.z - this.pos.z)`（树→伐木者反方向向量角，Ry 后再 Rx 倾覆——方向即倒向，容差由 G25 按同公式校验）。字段 `TreeEnt.fallYaw?: number` 表现层，不入任何持久化。
- **D4 砸地反馈**：`tickDeathAnims` 终态分支（splice 前）→ `shakeCamera(0.016 + fallDur × 0.05)`（橡 0.054 rad·m / 桦 0.037 分档）+ `sfx('down')`。thud 保留在 applyTreeVisible(false)。
- **D5 震屏实现**：`renderer.ts` 内部 `shakeAmp/shakeT`，`shakeCamera(a)` 取 max；`shakeTick(realDt, time)` 由 main loop 在 `updateCamera()` 之后调用：`camera.position.add(随机向量×shakeAmp×sin(now×46))`，`shakeT-=dt` 归零。updateCamera 下帧全量重设 ⇒ **无残留**（spec"震停即恢复"由构造保证）。不碰 cam 球坐标状态量。
- **D6 夹具**：`__GAME__.fallInfo()` → `{ dying: [{species, t, dur, yaw}], shake: number }`（world.ts 导出 `dyingTrees` 只读快照 + shake 值经 renderer 导出函数读取）。G25 用**砍后立即首拍**采样断 dur/yaw，`down/thud` counts 增量断声音联动。
- **D7 与 sound-system 的时序**：sfx 节流 0.2s 真实时间——thud（起）与 down（终）不同名互不吞；0.42s 最短倒程仍 > 节流窗 ✓。
- **D8 采集进行中树被砍的右键**：倒地中（alive=false）拾取仍可命中树体（matrix 未终态）→ commandAt `ent.ent.alive` 门 fall-through 成 move——与现状一致，无新增风险。

## Risks

- **尾段 90° 与地面穿插**：θ 上限 π/2−0.06 + 0.82 收出画，躺平时树冠略抬离地；低多边形风格可接受，不做物理。
- **shake 与 rightClickWorld 同帧竞争**：震仅 0.18s 且幅度 <0.06——测试中倒地后立即右键的断言（G23② gone 窗 30s）不受影响；G25 震后点击留 300ms。
- **dyingTrees 快照导出泄漏内部对象**：fallInfo 返回逐字段拷贝（t 为数值），不暴露 tree 引用。
