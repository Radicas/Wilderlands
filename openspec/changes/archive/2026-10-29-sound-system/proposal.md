# Proposal

## Why

游戏至今**全聋**：视觉反馈链（飘字/消亡动画/生命感/森林生态）已经打磨到第四个 change，但玩家每一次挥斧、每一声狼吼、每一个夜晚都落在绝对寂静里。声音是**唯一还没打开的感官通道**，也是"粗糙→有质感"性价比最高的一击——不新增玩法、不动平衡，纯表现层即可让同一批既有交互立刻换气质。同时昼夜系统只有光照变化，夜晚没有虫鸣与远嚎，"白天赶路夜里扎营"的生存感缺一半听觉支柱。

## What Changes

- **ADDED 合成音效层**：`src/core/sound.ts` 单模块收口，WebAudio 实时合成（噪声脉冲+振荡器+包络），**零素材文件、零体积增长、零授权问题**。覆盖约 10 类关键事件：挥斧命中/矿镐/采果、收获入账、受击/狼咬/狼嚎（远景低频）、建造落木/修船/通关号角、招募成交/拒绝闷音等
- **ADDED 昼夜环境底噪**：白天鸟鸣点缀+风底噪，夜晚虫鸣+风压低；随 `timeOfDay.isNight` 交叉淡入（表现层时钟，不碰 sim Rng）；夜间偶发狼远嚎（节流随机）
- **ADDED 静音开关**：HUD 按钮 + M 热键；状态写入存档 **可选字段**（旧档缺省视为未静音）——`SAVE_VERSION 保持 5`，无破坏性迁移
- **解锁策略**：AudioContext 懒建，首个用户手势（pointerdown）resume——浏览器自动播放策略合规；无 WebAudio 环境（含 headless 无音频设备）**静默降级不崩**
- **明确不镜像 sim**：声音与 gainFx/floaters 同类，属纯表现；双轨镜像原则只约束规则层。全部调用点位于前端专属文件（entities/unit、systems/combat、core/world、ui、main），共享模块与 sim 轨零触碰
- **防 turbo 炸音**：同名音效 0.2s 真实时间节流（快进 ×8 时游戏事件密度 ×8，听觉不可承受）
- 测试新增 **G24 声音系统**：断言"事件派发正确"（夹具 ring 记录），不测可听响度（自动化测不了耳朵）；现有各组零基线迁移

## Impact

- **Affected capabilities**: 新增 `audio-sfx`（事件音效）、`audio-ambience`（环境底噪/静音/持久化）
- Affected code: `src/core/sound.ts`（新建）、`src/entities/unit.ts`、`src/systems/combat.ts`、`src/systems/build.ts`/`ship.ts`/`trade.ts`/`recruit` 相关命令路径、`src/core/world.ts`（倒木沙沙）、`src/systems/daynight.ts`（底噪联动）、`src/ui/hud.ts`（静音钮）、`src/systems/save.ts`/`migrate.ts`（可选字段）、`src/main.ts`（解锁/夹具/stepGame 接线）、`src/config.ts`（音量/节流参数）
- Affected tests: `scripts/e2e-blackbox.mjs`（+G24），sim-run 无动（sim 不发声），README 夹具表/组数行 + DESIGN 一行
