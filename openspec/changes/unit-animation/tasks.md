# Tasks

## 1. 常量与夹具

- [x] 1.1 `config.ANIM` 新增：turnSpeed/breathRate/breathAmp/lookMin/lookMax/lookSwing/fallTime/tailSwing/earFlinch（全部数值单一来源）
- [x] 1.2 `main.ts` 调试夹具 `animState(i)` 只读 getter：返回 `{ visFacing, tilt, tool }`（工具形态名），README 调试钩子表同步

## 2. 转向平滑 + 待机生命感

- [x] 2.1 `_visFacing` 字段与最短角差 slerp（`_updateAnimation` 内驱动；335/501 两处 `mesh.rotation.y` 直写改读 `_visFacing`；逻辑 `facing` 不动）
- [x] 2.2 idle 呼吸（torso y 微幅正弦）+ 头部环视计时器（4~8s 随机触发 ~0.4s yaw 小摆）
- [x] 2.3 walk/gather 状态下呼吸与摆腿不冲突（呼吸仅 idle 或全态低频叠加，实测观感定）

## 3. 倒地/苏醒/死亡姿势

- [x] 3.1 `_downTilt` 0→1 补间（fallTime 0.3s）：侧卧 rotation.z + 沉降；苏醒反向；dead 冻结在 tilt=1 侧卧
- [x] 3.2 确认 down/dead 全路径（takeDamage、饥饿致死、sim 无关）视觉一致；逻辑计时/判定零改动

## 4. 狼细节 + 工具形态

- [x] 4.1 尾摆（移动步频联动）、受击 `_flinchT` 0.25s 双耳后压、idle 耳微转
- [x] 4.2 工具 4 形态预建（斧/镐/篮/矛）共享材质挂右手；`_animState`/`task.kind` 切换显隐；idle 收工具

## 5. 验收

- [x] 5.1 sim-run 哨兵：`node scripts/sim-run.mjs` 163/163 零波动（纯表现层豁免记录）
- [x] 5.2 黑盒新增 `G22 动画生命感`：转向后 `visFacing` 多帧渐变非跳变、idle `tilt=0` 且躯干呼吸（用 animState 夹具 + 时间采样）、右键倒地 0.4s 后 `tilt≈1`、砍树 `tool='axe'` idle `tool=null`；注册 GROUPS
- [x] 5.3 回归：`WL_ONLY=G20,G22` + 冒烟全绿（G20 覆盖行为层不回归）；tsc/build/lint 绿
- [x] 5.4 README（黑盒 22 组）/DESIGN（生命感行）同步

## 6. 提交

- [x] 6.1 动画实现提交 + 文档提交（change 归档随后续 archive 一并）
