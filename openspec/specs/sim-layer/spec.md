# sim-layer · 无头模拟层

## Purpose

定义 src/sim 纯逻辑世界：剥离渲染/输入/DOM 的可测试游戏内核，作为规则真相与回归验证的载体。

## Requirements

### Requirement: 无头确定性世界
sim 层 SHALL 提供不依赖 three/DOM 的世界（createSimWorld(seed, party)），同一种子 MUST 产生完全一致的初始世界与推进结果；开局人数默认与前端 START_PARTY 同源。

#### Scenario: 同种子同世界
- **WHEN** 用相同 seed 构建两次世界并推进相同步数
- **THEN** 两份世界的关键状态逐项相等

### Requirement: 规则单一来源
招募条件门（recruitBlockers）与存档迁移（migrate）等跨端规则 MUST 由共享纯函数模块实现，前端与 sim 引用同一份代码；平衡数值 SHALL 集中于 config。

#### Scenario: 前后端同判
- **WHEN** 同一局面分别经前端命令层与 sim 判定招募
- **THEN** 两者的通过/拒绝结论与理由完全一致

### Requirement: 回归断言套件
`scripts/sim-run.mjs` SHALL 以纯 node 运行全环节场景组（世界/昼夜/移动/采集/种收/建造/经济/战斗/贸易/修船/技能/背包/存档/补环节/属性），断言 MUST 可在无浏览器环境执行并全部通过。

#### Scenario: 无浏览器跑通
- **WHEN** 在纯 CLI 环境执行 sim-run
- **THEN** 全部断言通过且退出码为 0

### Requirement: 测试时间倍率
游戏主循环 SHALL 支持调试参数把逻辑按固定步长子步快进（?turbo=N），相机/输入/渲染 MUST 仍按真实时间运行，默认 1× 时与旧行为完全一致。

#### Scenario: turbo 不影响玩家
- **WHEN** 普通游玩（无 URL 参数）
- **THEN** 逻辑步进与真实帧率绑定，手感与快进前无差别
