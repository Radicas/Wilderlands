# Design

## 现状勘察结论

- 骨骼与走路/挥砍动画已存在（`_updateAnimation` + `ANIM` 块），本 change 补**断点**不是从零建
- 转向闪跳根因：`unit.ts:335` `mesh.rotation.y = this.facing` 直写 —— 逻辑 `facing` 保持即时正确（判定/路径不受影响），仅视觉层 slerp
- 工具已有通用"杆+块"形态常驻右手 —— 改为**按 kind 切形态 + 按状态显隐**
- 倒地姿势：`down` 进入/退出时 rotation.x 硬切；死亡 `update` 直接 return（姿态冻结在最后一帧=直立）

## 方案

**转向 slerp**：新增 `_visFacing`（仅渲染用），每帧以 `ANIM.turnSpeed`（弧度/秒）向 `facing` 的最短角差推进，`mesh.rotation.y = _visFacing`。角度差归一化到 [-π,π] 防绕远路。

**idle 生命感**：`_animState === 'idle'` 时躯干 `y += sin(t*breathRate)*breathAmp`（低频慢幅）；头部环视用计时器 `_lookT` 随机 4~8s 触发一次 ~0.4s 的 yaw 小摆（±20°，`head.rotation.y` 补间进出）。head 已挂 torso 下 ✓。

**倒地/苏醒/死亡**：`_downTilt` 0→1 补间（0.3s，`ANIM.fallTime`），应用 `mesh.rotation.z = _downTilt * (π/2 * 0.9)` 侧卧 + y 沉 0.25；苏醒反向补间；`dead` 保持 tilt=1 终态（尸体侧卧），复用现有隐藏时机。纯 rotation 插值，不触 down/downT/伤害逻辑。

**狼细节**：tail 已挂 torso（cones）——移动时 `tail.rotation.y = sin(t)*0.35` 摆尾；`_flinchT` 受击瞬间置 0.25s，期间双耳 `rotation.x = -0.6` 后压（takeDamage 已有的狼咬/被击分支顺带触发，仅视觉字段）；idle 耳朵 `_earT` 低频微转。

**工具形态**：`_toolHead` 按 `task.kind` 切换 `visible` 于 4 个预建 head（axe 扁盒/mattock T形/basket 小框/spear 现有加长杆），共享材质、同一挂点；idle/无任务 → 全不显示。`_animState` 切换处集中设置，避免逐帧分支。

## 约束与豁免

- 全部为渲染层字段（_visFacing/_downTilt/_flinchT 等），**不进 save、不进 sim**；163 sim 断言零波动作哨兵
- ANIM 新常量（turnSpeed/breathRate/breathAmp/lookMin/lookMax/fallTime/tailSwing）全部进 `config.ANIM` 单一来源
- 性能：新增每帧 ~10 次 sin/比较，单位数 ≤40，可忽略
- 黑盒 G22 观测面：`__GAME__` 需暴露只读动画字段？——不扩夹具，用 `getBoundingClientRect`+`units` 现有字段测不到骨骼旋转；**改用页内 evaluate 直读 window 场景**不可行（unit 不在全局）。方案：夹具只增一个 `animState(i)` 只读 getter（返回 {tilt, visFacing, tool} 三值）供 G22 断言，进 main.ts 调试钩子并文档化

## 顺序

与 death-system（谁触发倒地）、medical-limbs（部位伤姿势）正交：它们拥有"何时"，本 change 拥有"看起来如何"。若 medical 后续要"瘸腿拖行"，在 _updateAnimation 里挂分支即可，已预留 blend 机制。
