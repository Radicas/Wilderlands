# plan 011 · 角色 AI 技术方案

## 1. 新增文件

- `src/systems/personality.ts` —— 纯逻辑，无 three/DOM 依赖，可进 sim：
  - 类型：`CombatType`（aggressive/cautious/timid/stoic）、`WorkType`（hardworking/lazy/gatherer/woodsman）、`TraitType`（talkative/quiet/glutton/tough）、`Mood`（neutral/fear/irritable/exhausted/downcast）
  - `rollPersonality(rng)` —— 三维度随机
  - `decideWolfReaction(unit, distToWolf)` —— 返回 'engage' | 'retreat' | 'wait' | 'flee'
  - `findIdleWork(unit, trees, rocks, berries, leaderPos)` —— 10 米内找最近可采集目标
  - `speedMoodMultiplier(mood)` —— 情绪速度倍率
  - `workMoodMultiplier(mood)` —— 情绪工作倍率

## 2. 修改文件

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `Unit` 加 `personality: {combat, work, trait}`、`mood: Mood`；`UnitSave` 加这两个字段 |
| `src/config.ts` | 加 `CFG.idleScanRadius=10`、`CFG.idleScanInterval=2`、`CFG.moodFearRadius=15`、各倍率常量 |
| `src/entities/unit.ts` | 构造时 rollPersonality；update 里加闲时扫描计时器；情绪更新；速度/工作倍率接入 moveToward 和 gather |
| `src/systems/combat.ts` | updateWolves 里狼靠近玩家时，按性格决定是否主动 engage |
| `src/ui/hud.ts` | 上窗口加"当前行为"行；面板拆上下 |
| `index.html` | 左侧 `#sel` 拆成 `#selTop`（状态）+ `#selBottom`（背包） |
| `src/systems/save.ts` | collectSave/applySave 加 personality + mood |
| `src/systems/migrate.ts` | v4→v5 迁移，旧档随机补性格 |

## 3. 关键实现细节

### 3.1 闲时找活
- 每个 unit 加 `idleTimer`，每 2 秒检查一次（不是每帧）。
- 条件：`task === null && !down && !dead && invRatio < 1`。
- 调 `findIdleWork`，按 work 性格排序目标（gatherer 优先浆果，woodsman 优先树，hardworking 按距离，lazy 直接返回 null）。
- 找到就派一个 gather task（和玩家右键派的结构一样，workDur 用默认值）。
- 玩家下任何命令时，commands.ts 里已有的 `selected.forEach(u => u.task = ...)` 会覆盖闲时任务，不需要额外清理。

### 3.2 狼来了反应
- 在 updateWolves 里，对每只狼、每个玩家，计算距离。
- 如果玩家已有 attack/gather 任务 → 不干预（玩家命令优先）。
- 如果狼距离 < 8 且玩家 task === null：
  - aggressive → 派 attack 任务
  - stoic → 派 attack 任务（但 hp<30 时 flee）
  - cautious → wait（不主动，但也不跑，玩家上了他才上——这个靠他看到玩家攻击时跟随，简化为：什么都不做）
  - timid → 派 move 任务跑向 leader 或商摊
- 玩家右键点狼后 → 全员 attack（现有逻辑），性格靠边。

### 3.3 情绪更新
- 每 1 秒检查一次：
  - 被狼咬 → mood = fear（在 takeDamage 里触发）
  - hunger ≤ 20 → mood = irritable
  - stamina ≤ 20 → mood = exhausted
  - 队友倒地 → mood = downcast（在 combat.ts 里检测）
  - 恐惧消退条件：在商摊 15 米内 / 天亮 / 附近有其他队友 → mood = neutral
  - 吃东西 → mood = neutral（如果是 irritable）
  - 静止 10 秒 → exhausted 消退
  - 30 秒无触发 → downcast 消退
- 倍率：fear ×0.8 速度，irritable ×0.9 工作，exhausted ×0.9 速度，downcast 无倍率但压过话痨日志。

### 3.4 UI
- 上窗口"当前行为"：根据 task.type + mood 推导字符串：
  - task=gather+kind=tree → "正在砍树"
  - task=move → "移动中"
  - mood=fear → "害怕中"
  - task=null && mood=neutral → "空闲"
- 下窗口就是现有背包列表，不拆。

## 4. 性能

- 闲时扫描每 2 秒一次，每个 unit 一次线性查找 trees/rocks/berries（~300 个物体），3 个 unit 就是 900 次比较/2 秒，完全可接受。
- 情绪检查每 1 秒一次，O(1)。
- 不新增每帧的 three.js 对象。
