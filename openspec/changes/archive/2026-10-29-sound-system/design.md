# Design

## Context

表现层已有成熟通道：`state.gainFx`（飘字队列）、logMsg 门面、`bindVisible` 覆盖器。声音走同类：**core/sound.ts 单一出口，前端专属文件调用，共享模块与 sim 轨零触碰**。约束：浏览器自动播放策略（手势前不得出声）、turbo ×8 事件密度、headless 无音频设备、存档向后兼容（SAVE_VERSION 5 不动）。

## Decisions

- **D1 纯合成，零素材**：全部音色 = 噪声 buffer（一次性预生成 1s 白噪）经 BiquadFilter 频段整形 + OscillatorNode 音高 + Attack/Release 包络。砍＝低频闷噪短脉冲，入账＝上滑双音，受击＝失真正弦骤降，狼咬＝粗糙方波，建造＝三声部错落闷响，coin＝高频铃，refuse＝无音高纸闷声，win＝大三和弦琶音。包体积与授权为零。
- **D2 单模块收口**：`src/core/sound.ts` 导出 `sfx(name)` / `setBed(isNight)` / `toggleMuted()` / `soundStats()`（夹具用）+ `unlockSound()`。内部：懒建 ctx（首次 unlock/调用时才 new），masterGain→destination，床层两条常开节点（noise→lowpass→gain 风；bird/cricket 走 one-shot 调度）。**未解锁时 sfx 只进 ring 记录直接 return**——headless/node 永不触碰 AudioContext 构造（模块顶层零副作用，满足 sim 红线）。
- **D3 挂点清单**（全部前端文件，共 ~12 处）：`entities/unit.ts` 工作节拍（hitInterval = workDur/3 的整数跨越→chop/mine/pick 按 kind）与 `_finishGather`（pickup）+背包满（refuse）+takeDamage（hurt）+倒地（down）；`systems/combat.ts` 狼咬（bite）与狼死亡（down 低腔）；`core/world.ts` applyTreeVisible(false)（thud 沙沙，树倒）；`systems/build.ts`（build）、`ship.ts`（repair×里程碑/win）、`trade.ts`（coin）、`commands.ts`（招募 yes/no、幼树免砍 refuse、选中反馈 tick 轻点）。共享模块（personality/recruit 纯函数、state、sim/**）不加任何调用。
- **D4 解锁路径**：`main.ts` 挂 `window.addEventListener('pointerdown', unlockSound, { once:true })`；playwright 合成 click 是真 pointer 事件，e2e 天然解锁。iOS/Safari 同策略覆盖。
- **D5 节流口径 = 真实时间**：`sfx(name)` 记 `lastAt[name]`，同名 <0.2s（CFG.sound.hitThrottle）直接吞（**吞发声不吞 ring**——测试仍可断言事件密度）。
- **D6 昼夜床联动**：`daynight.ts.updateDayNight` 在 isNight **翻转沿**上调 `setBed(isNight)`（每帧调也幂等，但沿调用省 gain ramp）。鸟鸣/虫鸣点缀由 sound.ts 内部 `Math.random()` 排程（2–6s 随机），间隔参数进 CFG.sound；**禁用 sim Rng**（确定性红线）。狼嚎：night 时 20–60s 随机 one-shot howl。
- **D7 静音与存档**：muted 是 sound.ts 内部状态 + HUD 按钮（hud.ts 右上区，复用按钮监听约定）+ M 热键（core/input.ts keydown 分派处）。`save.ts` 写 payload 加可选 `muted?: boolean`；`migrate.ts` 不加 case（缺字段 = false 天然兼容），**SAVE_VERSION 保持 5**。静音时 masterGain=0 + 床层 ramp 到 0，事件记录照常。
- **D8 可测性夹具**：`window.__GAME__.soundStats()` 返回 `{ unlocked, muted, bed: 'day'|'night', ring: string[]（最近 30 事件名，含节流吞掉的）, counts: Record<name,number> }`。G24 断言口径 = **事件派发正确性 + 节流 + 昼夜沿 + 静音持久化**，不测响度（耳朵不在自动化范围）。
- **D9 音量与性能**：master 默认 0.5（CFG.sound.master）；one-shot 用 `stop(t+d)` 后 nodes 自动断开（onended 不依赖）；同帧最大发声数天然被节流压住。不做距离衰减（v1 平面声场，风险记入后续）。
- **D10 sim 无镜像义务（明确破例声明）**：镜像原则约束规则层；声音与 floaters 同类纯表现，`sim-run.mjs` 不新增任何声音断言。此为惯例重申非改变。

## Risks

- **headless 音频栈缺失**：new AudioContext 在部分 CI 镜像直接抛——D2 的"手势前零构造 + try/catch 全包裹"覆盖；G24 断言只依赖 ring。
- **turbo 交互串扰**：×8 下 workT 步进极快，节流吞发声不吞记录，听感正确；e2e 用 counts 而非相邻事件序。
- **input.ts 热键冲突**：M 当前空闲（已核：现有键位 1-9/esc/shift/tab），新增前再 grep 确认。
- **Safari resume 异步**：resume() 返回 promise，首发丢一两个包可接受，不做预渲染。
