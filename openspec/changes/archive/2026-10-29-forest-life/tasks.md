# Tasks

## 1. 配置与类型地基

- [x] 1.1 `config.TREES` 三种树表（松 3木/2.2s/45s · 橡 4木/2.8s/60s · 桦 2木/1.8s/30s，含显示名与 `toMature` 分配 `{stump:15, sprout, young}`）；`WORLD.treeCount: 220 → 150`；新增 `WORLD.treeMinGap: 3.2`
- [x] 1.2 `types.ts`：`TreeEnt` 扩展 `{species, phase:'stump'|'sprout'|'young'|'mature', phaseT, mats:{sprout,young,mature}}`；`src/sim/types.ts` SimTree 同步（mats 除外）

## 2. 世界生成（前端轨）

- [x] 2.1 三种干/冠几何入 `core/world.ts`（松=现几何；橡=双球合并 BufferGeometry 冠+粗短干；桦=细高白干+小球冠），材质入 PALETTE 扩项
- [x] 2.2 `buildTrees` 改造：`i%4` 物种映射 + 3.2m 最小间距拒绝采样（≤6 次尝试弃点）；每树种一套 trunkIM/crownIM 对；build 期预计算每棵树三阶段矩阵入 `TreeEnt.mats`
- [x] 2.3 实例索引重接：`resolveInstance` 按树种基址闭包；`applyTreeVisible`/`setInstanceUnder`/`tickDeathAnims` 从"全局 instanceId"改为 `(species, slot)` 定位；`treeOriginals` 退役并入 mats
- [x] 2.4 探针验证（design 三值清单）：合并几何 raycast 反查准确、reject 采样生成耗时 <50ms、换阶矩阵与死亡补间并发不互踩

## 3. 生长系统

- [x] 3.1 `updateWorld`（combat.ts）树循环改阶段机：stump 15s → sprout → young → mature，换阶拷贝 `mats` 写回 IM（同阶零写入）；`alive = phase !== 'stump'` 语义切换
- [x] 3.2 `unit._finishGather` 树分支：结算读 `TREES[species]`（木材数/飘字文案自动跟随），砍后 `phase='stump', phaseT=15`；消亡动画从当前阶段矩阵起步

## 4. 免砍门与文案

- [x] 4.1 `commands.ts` 右键树：非 mature → 拒绝 + 提示文案（含树种·阶段）；mature 建任务时 `workDur` 读树种表
- [x] 4.2 `_tryIdleWork/findIdleWork` 树候选过滤 mature（前端轨）
- [x] 4.3 `tooltip.ts`：`松树 · 成树 · 右键砍伐得木材` / `白桦·幼苗 · 再等等` 文案分级

## 5. sim 镜像与基线搬迁

- [x] 5.1 `sim/world.ts`：生成规则同构镜像（i%4 映射、间距拒绝、三阶段字段）；`sim updateWorld` 阶段机；结算/门在 `sim/unit.ts` 等价实现
- [x] 5.2 `sim-run.mjs` 基线搬迁：树数/间距口径、采集断言按松树锚（+3/2.2s 不变）、新增 3-5 条生态断言（幼苗拒采、45s 成材循环、橡桦产量差）；163±新总数全绿零意外
- [x] 5.3 `main.ts targets.trees` 只读扩展 `{species, phase}`（G23 与调试共用）

## 6. 黑盒与回归

- [x] 6.1 新增 `G23 森林生态`：树种齐+间距达标 / 砍松 45s 循环成材 / 右键幼苗被拒（无飘字无进包）/ 橡 +4 桦 +2 结算
- [x] 6.2 G4/G16/G21 适配新口径（树数、砍后进入 stump 的计数语义），`WL_ONLY=G3,G4,G14,G16,G20,G21,G22,G23` 批次全绿 + 冒烟 + tsc/build/validate 绿

## 7. 文档与提交

- [x] 7.1 README（23 组、config 表 TREES 行、夹具表）与 docs/DESIGN.md（森林生态行）同步
- [x] 7.2 实现提交（feat）+ 测试提交（test）+ 文档提交（docs），change 归档留待用户指令
