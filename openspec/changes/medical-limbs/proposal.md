# Proposal

## Why

S9（路线图一行）：受伤目前只扣血、痊愈无痕迹，"挨咬"缺少长期后果与医疗经济。立项断肢/假肢/medic 技能闭环：重伤害变得昂贵但可修复，给游商增加一条医疗货源线，给队伍一个"队医"角色生态。需求尚粗，本 change 立最小契约骨架，实施前用 openspec-explore 打磨。

## What Changes

- 受击有概率（依伤害类型与防御减免后）造成**部位伤残**：该部位标记缺失/受伤，带来对应行动惩罚（如腿伤减速）。
- **假肢**成为贸易站商品：购买后为伤员装配，恢复该部位功能（带轻微属性折扣，荒诞文案）。
- 新增 **medic 技能通道**：执行"治疗/包扎"行为累积经验，升级提高救援窗口效益与苏醒生命保留。
- 现有 HUD"部位状态"行从展示升级为可交互（选择治疗/装配）。

## Capabilities

### New Capabilities
- `medical-limbs`: 部位伤残、假肢修复、medic 成长的行为契约骨架。

### Modified Capabilities
（无。medic 作为新成长通道在自身能力内定义，暂不动 progression 条款。）

## Impact

- unit 部位模型扩展（已有 limbs 展示层，`entities/unit.ts` + `ui/hud.ts`）；economy/trade 新增商品与价格通道；config 新增概率与折扣数值；存档 v6/v7 需带部位状态（与 death-system 的 schema 变更合并考虑，避免连跳两版）。
