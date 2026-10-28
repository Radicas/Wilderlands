# Design

## 分层决策：事件缓冲解耦飘字

收获发生在 entities 层（`Unit._finishGather` / 击杀结算），渲染 DOM 在 ui 层，但 ui→entities 是唯一合法依赖方向。方案：`state.gainFx` 数组作为事件缓冲——entities 推入 `{x,y,z,text,color}`，`main.stepGame` 每帧调 `drainGainFx()` 消费并清除。sim 层不引用该缓冲（纯表现），**sim 无镜像义务**：本 change 所有行为不改变任何结算，163 条 sim 断言应零波动（作为回归哨兵）。

## 飘字投影

`THREE.Vector3(world).project(camera)` → 画布矩形换算页面坐标，DOM `.floater` 绝对定位于 `#floaters`（`pointer-events:none; z-index:6`）。CSS animation 1.2s 上浮 46px 淡出，`setTimeout` 移除节点。相机背面（`v.z>1`）不生成。不引入每帧 transform 更新（飘字跟随出生点，1.2s 内相机平移可接受——Kenshi 类游戏同款）。

## 消亡补间

`core/world.ts` 维护 `dyingTrees/dyingRocks: Map<id, t>`：`applyTreeVisible(false)` 进入补间（对原始矩阵 decompose → 每帧 scale 线性趋 0 + y 下沉 0.3），`tickDeathAnims(dt)` 由 stepGame 调用（turbo 固定 0.05 子步天然适配）；结束落入原"地下深处"终态。`applyTreeVisible(true)`（重生）清除补间条目恢复原始矩阵。误点防护：commands 层右键落树时校验 `alive`，补间期间已置 false → 天然拒绝。

## 状态条

`hud.ts` 的「当前行为」行拼接 `Math.round((hunger*0.5 + stamina*0.5)*10)` 格 `▓`。不改任何数值系统；`▓░` 为等宽字符保证 HUD 不抖动。

## 测试与豁免

黑盒新增 `G21 收获反馈`：①右键砍树→`#floaters .floater` 文本含 `木材`（轮询 ≤3s，考虑 turbo 缩放）②背包满场景无 `.floater` ③curAction 含 `▓`。sim-run 豁免理由：无结算/规则变化，表现层不进 headless（沿用 009 存档、HUD 类先例）。

## 已知顺序依赖

character-ai（未归档）引入「当前行为」行；本 change 的 hud 差量在其上追加状态条。建议先 `openspec archive character-ai` 再归档本 change，规格合并顺序才干净。
