# Tasks

## 1. 骨架
- [x] 1.1 1.1 `src/systems/wildlife.ts`：CritterEnt 类型 + initWildlife（兔6/鹿4/鸟阵，出生地采样）+ wildlifeTick(realDt) 状态机（hop/graze/flee/sky），reduced-motion 与夜间分支
- [x] 1.2 1.2 `src/core/sound.ts`：`onBirdCall(cb)` 轻量钩子（soundTick 触发 bird 时广播）；wildlife 订阅同步 skyActive 窗口
- [x] 1.3 1.3 `src/main.ts`：init 接线（buildTrees 后）+ loop wildlifeTick(real) + 夹具 wildlifeStats()

## 2. 行为调参
- [x] 2.1 2.1 惊跳/避离参数落地（6m/9m、速度档、冷却），鹿群聚合跟随
- [x] 2.2 2.2 撞树滑散 + 贴地

## 3. 断言
- [x] 3.1 3.1 G26 鹿避离：传送 5m 内 → nearestDeer.d 递增 && 鹿不在 targets
- [x] 3.2 3.2 G26 兔惊跳：靠近 → maxHop 跳升（对比静置基线）
- [x] 3.3 3.3 G26 鸟鸣同源：waitFor soundStats counts.bird 增量 → 同拍 skyActive=true（或反向：skyActive 期间 bird 计数>0）
- [x] 3.4 3.4 G26 规则零污染：inter 注册数与无动物基线一致（夹具 countInter）+ G4 抽一条回归 + 存档 roundtrip 无 wildlife 字段
- [x] 3.5 3.5 回归批（含新组）+ sim 169 + 冒烟 21 + tsc/build/validate

## 4. 文档与提交
- [x] 4.1 4.1 README 26 组 + 夹具行；DESIGN 动物群行
- [x] 4.2.2 三提交（feat/test/docs），归档等用户指令
