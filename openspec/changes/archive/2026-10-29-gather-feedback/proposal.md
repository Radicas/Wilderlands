# Proposal

## Why

玩家实玩数分钟后反馈三条不舒服：①场景资源与人物比例失真（树仅 2.8m ≈ 1.6 倍人高）；②昼夜 4 分钟一轮太快；③**采集资源零反馈**——物品进包只有右侧日志滚一行，被砍的树瞬间"橡皮擦"消失，辛苦劳作得不到任何即时确认。前两条为 config 数值调整（已随本轮完成：树/石几何入 `SCENE` 单一来源、昼夜 600s + `nightStartRatio: 0.75` 参数化，163 断言与 G4/G16 全绿），本 change 专注第三条：**给资源获取建立即时的视觉反馈层**。

## What Changes

- **ADDED 收获飘字**：木材/石头/浆果/作物收获与击败野狼的物品进包瞬间，角色头顶浮出 `+N 木材` 类飘字（资源色区分，约 1.2 秒上浮淡出），纯 DOM 叠加层，不动 WebGL
- **ADDED 资源消亡动画**：砍倒的树、采空的矿脉由"瞬时消失"改为 ≈0.4 秒下沉缩小动画（InstancedMesh 矩阵补间），浆果丛保留即时隐藏（矮丛合理）；重生逻辑与拾取一致性不变
- **MODIFIED 干活可视化**：HUD「当前行为」行追加迷你状态条（`▓░` 10 格，体力×饥饿综合健康度），采集/战斗/收获任务期间随行显示
- 全部为表现层：不改任何游戏规则与数值结算，**sim 无镜像义务**（事件缓冲 `state.gainFx` 由 entities 推入、ui 消费，sim 不引用）；存档 schema 不变（SAVE_VERSION 保持 5）

## Capabilities

### New Capabilities
- `gather-feedback`: 资源获取的即时视觉反馈（飘字、消亡动画、进度可视化），含"事件缓冲由 entities 推入 / ui 层消费"的分层约束

### Modified Capabilities
- `hud`: 「当前行为」显示追加状态条（该需求原由 change character-ai 引入；归档顺序建议 character-ai 先行，避免规格叠加歧义）

## Impact

- **代码**：`src/ui/floaters.ts`（新增）、`src/state.ts`（gainFx 缓冲）、`src/entities/unit.ts`（5 处进包钩子）、`src/core/world.ts`（消亡补间 + tickDeathAnims）、`src/main.ts`（帧循环接线）、`src/ui/hud.ts`（状态条）、`index.html`（飘字 CSS）
- **测试**：黑盒新增 `G21 收获反馈`（飘字 DOM 断言 + 状态条文案断言 + 消亡动画后计数断言）；sim-run 豁免（纯表现层，无规则变化，tasks 中留豁免记录）
- **现状**：实施 WIP 已存在于工作区（未提交）——本 change 的 apply 从这里继续并补完消亡动画与测试
