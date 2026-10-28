# Tasks

## 1. 数据与字段
- [x] 1.1 1.1 `config.TREES` 三行各加 `fallDur`（松 0.55 / 橡 0.75 / 桦 0.42）
- [x] 1.2 1.2 `types.TreeEnt` 加 `fallYaw?: number`（表现层，不入存档，注释标明）

## 2. 倒地与反馈
- [x] 2.1 2.1 `core/world.ts`：DyingTree → `{tree,t,dur,yaw,trunk,crown}`；applyTreeVisible(false) 落 dur 快照+yaw（fallYaw 缺省随机）；tickDeathAnims 树分支换倾覆矩阵链（D1），终态分支 `shakeCamera(0.016+0.05×dur)` + `sfx('down')` + `dyingSnapshot()` 导出
- [x] 2.2 2.2 `entities/unit.ts` `_finishGather`：visible=false 前写 `tree.fallYaw = atan2(t.p−player)`（D3 公式）
- [x] 2.3 2.3 `core/renderer.ts`：`shakeCamera/ shakeTick / shakeValue`（D5，updateCamera 后叠加自愈）；`main.ts` loop 在渲染前 `shakeTick(real)`

## 3. 夹具与断言
- [x] 3.1 3.1 `main.ts` 夹具 `fallInfo()`（dying 样本拷贝 + shake 值）
- [x] 3.2 3.2 e2e 新增 G25 砸地倒树 6 项：松 dur0.55+背向 yaw / 橡 dur0.75 与桦 dur0.42 差异 / 终态计数落账+15s 后冒苗（复用 ② 通道抽一条） / down+thud counts 各 +1 / 震后右键命令正常（无残留） / console 干净
- [x] 3.3 3.3 回归批 `G3,G4,G16,G17,G20,G21,G22,G23,G24,G25` + sim 169 + 冒烟 + tsc/build/validate

## 4. 文档与提交
- [x] 4.1 4.1 README（24→25 组，fallInfo 夹具行）+ DESIGN 森林行补"定向倒地"
- [x] 4.2 4.2 三提交（feat/test/docs），归档留待用户指令
