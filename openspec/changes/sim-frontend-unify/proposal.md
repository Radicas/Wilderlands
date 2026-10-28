# Proposal

## Why

前端（src/systems|entities）与无头 sim（src/sim）是**两套平行实现的同一套规则**，本会话已多次付出双轨漂移成本（招募门要改两处、断言清单要同步写两份）。原 Spec Kit spec 009 提出"前端接 sim 渲染"：让 sim 成为唯一逻辑真相，前端只做表现层。这是纯架构重构，不改变任何对外行为——因此本 change 不携带 spec delta（skip_specs），产出风险由现有 152 条 sim 断言 + 黑盒回归兜底。

## What Changes

- 前端主循环改为驱动 sim 世界：输入/命令翻译成 sim 指令，渲染层（three meshes/InstancedMesh/HUD）读 sim 状态投影。
- entities/systems 中与 sim 重复的规则代码退役；保留表现专用模块（renderer/tooltip 几何等）。
- 行为对齐清单逐项核对（帧率耦合、输入即时性、任务取消语义），迁移期间以 sim-run + 黑盒全绿为合闸条件。
- **BREAKING 仅限内部架构**：玩家可观察行为、存档格式、平衡数值零变化。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
（无——`sim-layer` 的现有条款已承诺"规则单一来源"方向，本重构是实现而非契约变更；待实施中对 sim-layer 条款有任何可观察调整时，再补 delta。）

## Impact

- `src/main.ts` 循环、`core/input.ts`、`systems/commands.ts`（命令→sim 指令映射层）、`entities/unit.ts` 与 `sim/unit.ts` 合并路径、`ui/hud.ts` 数据源切换。
- 测试：sim-run 断言全部保留；黑盒行为基准不变；性能需盯渲染预算（sim 步与帧解耦已在 turbo 机制中验证）。
- 工作量最大的一项重构，建议拆 3-4 个子 PR：单位镜像 → 命令映射 → 渲染投影 → 旧代码退役。
