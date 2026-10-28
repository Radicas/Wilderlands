# tasks 011 · 角色 AI

> 每完成一步跑 `npx tsc --noEmit && npm run build && node scripts/smoke.mjs`。

## T1. 类型与配置
- [ ] types.ts：加 CombatType/WorkType/TraitType/Mood 类型；Unit 接口加 personality + mood；UnitSave 加这两个字段
- [ ] config.ts：加 CFG.idleScanRadius=10、idleScanInterval=2、moodFearRadius=15、速度/工作倍率常量
- 验证：tsc 通过（此时 unit.ts 还没填 personality 会报错，先给默认值）

## T2. personality.ts 纯逻辑
- [ ] 新建 src/systems/personality.ts：rollPersonality、decideWolfReaction、findIdleWork、speedMoodMultiplier、workMoodMultiplier
- [ ] 导出类型供 unit.ts 和 save.ts 用
- 验证：tsc 通过；这个文件不 import three，可被 sim 复用

## T3. unit.ts 接入性格与情绪字段
- [ ] PioneerUnit 构造时调 rollPersonality，存到 this.personality
- [ ] mood 初始 'neutral'
- [ ] takeDamage 被狼咬时设 mood='fear'
- [ ] 吃东西（invAdd food 或按 F）时如果 mood='irritable' 清掉
- 验证：游戏能跑，smoke 通过（行为还没接，但字段在）

## T4. 闲时找活
- [ ] unit 加 idleTimer 字段
- [ ] update 里：task===null && !down && !dead && 背包不满 → 每 idleScanInterval 秒调 findIdleWork，找到就派 gather task
- [ ] lazy 性格不找活
- [ ] gatherer 优先浆果，woodsman 优先树，hardworking 按距离
- 验证：选中一个勤劳角色不派任务，等几秒看他自己走过去砍树

## T5. 狼来了性格反应
- [ ] combat.ts updateWolves：狼距离玩家 <8 且玩家无任务时，按 decideWolfReaction 派任务
- [ ] aggressive/stoic（hp>30）主动 attack
- [ ] timid 主动 flee（move 到 leader 位置）
- [ ] cautious 不动
- 验证：放一只狼在没选中的玩家附近，看莽夫冲、胆小跑

## T6. 情绪影响行为
- [ ] moveToward 速度乘 speedMoodMultiplier(mood)
- [ ] gather workT 累积乘 workMoodMultiplier(mood)
- [ ] 情绪消退逻辑：每 1 秒检查恐惧/疲惫/低落消退条件
- [ ] irritable 由 hunger≤20 触发，吃东西后消
- 验证：把一个人 hunger 调到 10，看他干活变慢；喂东西后恢复

## T7. UI 改造
- [ ] index.html：#sel 拆成 #selTop（状态+当前行为）+ #selBottom（背包）
- [ ] hud.ts updateHUD：上窗口加"当前行为"行，根据 task+mood 推导
- [ ] CSS 调整上下两块间距
- 验证：选中角色截图看布局

## T8. 存档 v5
- [ ] save.ts collectSave：units[i] 加 personality + mood
- [ ] save.ts applySave：恢复 personality + mood
- [ ] migrate.ts：SAVE_VERSION 4→5，旧档随机补性格
- 验证：存档再读档，性格不丢；旧档能读

## T9. 日志与文案
- [ ] 话痨性格干活时偶尔吐槽（按概率，不刷屏）
- [ ] mood=fear 时日志一句"XX 在发抖"
- [ ] mood=irritable 时日志一句吐槽
- 验证：话痨角色跑一会能看到随机吐槽

## T10. 最终验证
- [ ] tsc 0 错误
- [ ] build 通过
- [ ] smoke 21+ 通过（按需更新 smoke：检查 personality 字段存在）
- [ ] 截图：选中角色看上窗口布局
- [ ] 手测：不派任务看勤劳自己找活、莽夫主动打狼、胆小逃跑
