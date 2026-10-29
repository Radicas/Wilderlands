# decor-wildlife Specification

## Purpose
定义装饰动物群：林缘兔群、鹿群与掠空鸟编的存在、行为（惊跳/避离/排程掠空）与表现层红线（不可交互、不进规则表、不进存档与模拟轨）。

## Requirements

### Requirement: 装饰动物群存在于世界且不参与规则
世界 SHALL 常驻装饰动物：兔约 6 只（林缘跳跃游走、玩家 6m 内惊跳窜远）、鹿 3-4 只一组（吃草低头周期、玩家 9m 内背离避离）、鸟编队 5 只（真实时间排程周期性掠空）。动物 MUST NOT 注册为可拾取对象、MUST NOT 进入 targets/战斗/经济任何规则表、MUST NOT 进入存档与 sim 镜像；数量与位置由表现层 Math.random 驱动（禁碰 sim Rng）。reduced-motion 下 SHALL 静止保位（不弹跳不定格消失）。

#### Scenario: 鹿群见人避离
- **WHEN** 玩家传送至距最近鹿 5m 处并停留
- **THEN** wildlifeStats 的最近鹿距离随时间增大（背离移动，速度低于玩家奔跑），且该鹿不在 targets 列表内

#### Scenario: 兔子惊跳
- **WHEN** 玩家靠近任一兔至 6m 内
- **THEN** 该兔 hop 峰值>0（弹跳位移记录），窜离方向背离玩家

#### Scenario: 鸟鸣与掠空同源
- **WHEN** sound 排程触发一声 bird 啁啾
- **THEN** 同真实时间窗内鸟编队处于掠空状态（skyActive=true），两者由同一排程器驱动

#### Scenario: 规则表零污染回归
- **WHEN** 动物在场景内任意活动
- **THEN** G4/G16 采集计数、狼 AI、存档 roundtrip 与无动物基线完全一致（targets/inter 注册数不增、SAVE 字段不减不加）
