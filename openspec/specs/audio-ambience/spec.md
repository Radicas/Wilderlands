# audio-ambience Specification

## Purpose
定义环境声景：昼夜底噪切换（风声/虫鸣/鸟叫/狼嚎）的排程与静音状态，为表现层提供不依赖模拟轨的氛围声。

## Requirements

### Requirement: 昼夜环境底噪
系统 SHALL 维护一条持续环境声床：白天为微风+偶发鸟鸣点缀，夜晚为低风+虫鸣节律，随 `timeOfDay.isNight` 交叉淡入淡出（≤3s 渐变，不得跳变）。夜间 SHALL 偶发远处狼嚎（20–60s 随机间隔，节流且仅夜晚）。环境随机 MUST 使用表现层随机源，MUST NOT 消耗 sim 确定性 Rng 流。

#### Scenario: 入夜声景切换
- **WHEN** 时间跨过夜阈值（isNight false→true）
- **THEN** 虫鸣增益渐入、鸟鸣停发；夹具可读出当前床层为 night

#### Scenario: 狼嚎只在夜里
- **WHEN** 白天时段任意长时间运行
- **THEN** ring 中不出现 howl 环境事件（战斗内受控狼嚎另算）

### Requirement: 静音开关与持久化
玩家 SHALL 可通过 HUD 按钮或 M 热键全局静音/取消静音；静音时 MUST 停止全部发声（含床层），事件派发记录仍照常（供调试/测试）。静音状态 MUST 写入存档的**可选字段**：旧存档缺字段视为未静音；该字段不触发存档版本升级（SAVE_VERSION 保持 5）。

#### Scenario: M 键立切
- **WHEN** 游戏中按 M
- **THEN** HUD 按钮态翻转、床层增益归零、后续 sfx 记录仍进 ring 但不出声

#### Scenario: 静音跨存档
- **WHEN** 静音后保存并读档
- **THEN** 读档后仍为静音；未静音旧档读出后默认非静音
