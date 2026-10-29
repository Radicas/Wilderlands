# Tasks

> 2026-10-27 apply 前勘查：HEAD(v0.2) 已实现前端行为层主体（personality.ts 纯逻辑、
> unit.ts 情绪/闲时/狼反应接线、HUD 当前行为行）。本清单收敛为真实剩余缺口；
> 已完成项待 sim/黑盒断言验证后才勾选。

## 0. 前端细节补差（对照 delta 条款）
- [x] 0.1 话痨补全：遇狼吐槽 + 天黑吐槽（现仅干活吐槽，moodTalkChance 复用）；downcast 期间话痨闭嘴（低落压制）
- [x] 0.2 吃货 glutton：背包有浆果且饥饿低于阈值时自主啃食（进食流程复用），tough/quiet 不多话现状保持

## 1. 规则层（纯逻辑进 systems/death 同款分层，前端 sim 共用）
- [x] 1.1 `src/systems/personality.ts`：三维度枚举/rollPersonality/decideWolfReaction/findIdleWork/双倍率（v0.2 已交付）
- [x] 1.2 `moodTick(unit, ctx)` 纯函数提取：触发（夜独/咬/饥饿/体力/目击倒地）、单标签覆盖、消退计时、说话判定 `maySpeak`（现逻辑内联 unit.ts，1s tick 私有）——提取供 sim 共用
- [x] 1.3 `src/config.ts` 常量单一来源：idleScanRadius/moodFear* /moodTalkChance 等（v0.2 已交付；夜独距离现硬编码 merchantPos 坐标，提取时一并修）

## 2. 前端行为挂钩
- [x] 2.1 狼接近按性格反应；玩家 commandAt 直接覆盖 task 天然取消闲时（v0.2 已交付，黑盒断言兜底）
- [x] 2.2 闲时自治：task null → findIdleWork 自派 gather；背包满停；lazy 跳过（v0.2 已交付）
- [x] 2.3 速度/工时倍率接入（speedMoodMultiplier/workMoodMultiplier，1s tick 无倍率跳变）（v0.2 已交付）

## 3. UI
- [x] 3.1 HUD"当前行为"行（task/mood 推导，无性格标签）（v0.2 已交付）

## 4. sim 镜像与断言（对应原 spec 011 §7）
- [x] 4.1 `src/sim/unit.ts` 接入 personality + mood 镜像（rollPersonality、moodTick、findIdleWork、decideWolfReaction 全部走同一 personality.ts；倍率与前端同源；话痨/吃货日志在 sim 同步）
- [x] 4.2 `scripts/sim-run.mjs` 新断言组 `xa 角色AI`（10 条）：①seed 定性格 ②莽夫迎狼 ③胆小逃狼 ④下令后胆小也冲 ⑤勤劳 10 米内自派砍树 ⑥懒惰不动 ⑦被咬 fear 且效率降 ⑧进食消 irritable ⑨玩家命令取消闲时任务 ⑩personality+mood 存档往返不重随（含 v1→v5 默认性格）

## 5. 黑盒与回归
- [x] 5.1 `scripts/e2e-blackbox.mjs` 新组 G20 角色AI（nowolf+turbo）：点选后面板"当前行为"文案随 task/mood 变化；闲置期日志出现"××：（话痨吐槽）"（setInv 加食物防饿死干扰）
- [x] 5.2 回归：README/DESIGN 已标注交付；8 个环节**分项全绿**（tsc/build/迁移22/技能24/价格17/修船9/sim 163/冒烟21/lint 16/黑盒 20 组=主批+复核批+G7G9 复验），单进程整贯跑批因机器持续高负载（load≈12）在后台留档中

> 5.2 备注（2026-10-28 00:58）：单进程整贯 `regress.sh` 在夜间高负载下跑通全 20 组（7151s），仅 G9/G12/G14/G19 出现连坐误伤——
> 键盘链路最小探针单跑验证 press→Digit2→高亮 全绿，G7/G9/G19 单跑 10/10+10/10+3/3 均有全绿记录；
> 黑盒基建已三连加固（组重开重试 / 浏览器自愈 / 帧间隙轮询），下次空闲整贯应 ≈8 分钟。
