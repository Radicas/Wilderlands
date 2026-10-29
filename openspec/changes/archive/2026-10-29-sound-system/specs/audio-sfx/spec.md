# audio-sfx 规格差量

## ADDED Requirements

### Requirement: 关键交互合成音效
系统 SHALL 为下列事件各提供至少一种 WebAudio 实时合成音效（不依赖任何外部素材文件）：采集挥击（按资源类型区分音色：斧/镐/采果）、收获入账、角色受击、狼咬击、建造落成、修船进度、主线通关、招募成交、操作被拒（闷音）。音效 MUST 经 `sfx(name)` 单一入口派发；同一音效名在 0.2 秒真实时间内 MUST NOT 重复出声（turbo 快进防炸音）。

#### Scenario: 砍树有挥击与入账
- **WHEN** 角色对成树执行采集并完成结算
- **THEN** 工作期间派发"斧击"类音效、结算时刻派发"入账"音效（夹具 ring 可见）

#### Scenario: 快进不炸音
- **WHEN** turbo ×8 下大量工作 tick 连续触发挥击
- **THEN** 同名音效两次发声间隔不小于节流窗口（真实时间口径）

### Requirement: 手势解锁与静默降级
AudioContext MUST 懒创建，并在首个用户 pointerdown 时创建/resume；解锁前调用 `sfx` MUST NOT 抛错（静默吞放）。运行环境不支持 WebAudio（或上下文被永久拒绝）时，声音层 MUST 整体降级为 no-op，MUST NOT 影响任何游戏逻辑与测试执行。

#### Scenario: 首击即响
- **WHEN** 玩家进入页面后的第一次点击恰好下达砍树命令
- **THEN** 指针事件先于命令处理完成解锁，该轮挥击有音效记录

#### Scenario: 无音频环境全绿
- **WHEN** headless 环境无音频输出设备
- **THEN** 游戏与全部 e2e 组照常通过，无 console error

### Requirement: 声音不进模拟轨
音效派发 MUST 只发生在前端表现层代码路径；headless sim MUST NOT 导入或实例化任何 AudioContext 相关对象，sim 断言口径不因声音系统改变。

#### Scenario: sim 后台跑不碰声音
- **WHEN** `node scripts/sim-run.mjs` 在纯 node 环境执行
- **THEN** 全部断言通过且不出现 WebAudio 引用错误
