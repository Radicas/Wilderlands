# Implementation Plan: 视觉精细化升级

**Branch**: `001-visual-polish` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-visual-polish/spec.md`

## Summary

在不改变玩法逻辑、不引入外部资源的前提下，对 Wilderlands 的三个视觉维度做低多边形风格的精细化升级：(1) 角色和动物模型从方块堆叠改为分段几何体组合；(2) 平坦地形改为有缓坡起伏的噪声地面；(3) 单位从整块平移改为带四肢摆动的程序化动画。

## Technical Context

**Language/Version**: TypeScript 5.5

**Primary Dependencies**: Three.js 0.160（已安装）、Vite 5、无新增依赖

**Storage**: N/A（纯前端内存状态，无持久化）

**Testing**: 手动验证（headless 像素采样 + `tsc --noEmit` + `vite build`）

**Target Platform**: 现代桌面浏览器（WebGL）

**Project Type**: 纯前端 3D 沙盒游戏原型

**Performance Goals**: 同屏满载帧率下降 ≤5%，单个模型 ≤200 三角面

**Constraints**: 不引入外部 .glb/.gltf/贴图资源；不改变现有玩法数值和交互逻辑；保持 low-poly 风格

**Scale/Scope**: 修改 4 个源文件（unit.ts、world.ts、renderer.ts、config.ts），新增约 300-400 行代码

## Constitution Check

| 宪法原则 | 是否通过 | 说明 |
|---|---|---|
| I. 纯前端零后端 | ✅ | 全部改动在前端渲染层，不引入任何网络请求 |
| II. 单一数值数据源 | ✅ | 新增的视觉参数（起伏幅度、动画速度等）全部加进 `config.ts` |
| III. 模块化分层 | ✅ | 模型改动在 entities/unit.ts，地形改动在 core/world.ts，动画逻辑在 unit.ts 内部，不跨层 |
| IV. TypeScript 严格模式 | ✅ | 新增代码用现代类型语法，`tsc --noEmit` 保持 0 错误 |
| V. 性能与渲染纪律 | ✅ | 模型复用几何体，动画用 sin/cos 关键帧，不每帧 new 临时对象 |

**结论**：全部通过，无需豁免。

## Project Structure

### Documentation (this feature)

```text
specs/001-visual-polish/
├── spec.md              # 需求规格
├── plan.md              # 本文件
├── tasks.md             # 任务拆解
└── checklists/
    └── requirements.md  # 质量清单
```

### Source Code (repository root)

```text
src/
├── config.ts            # 新增：地形起伏参数、动画速度参数
├── types.ts             # 新增：动画状态类型、四肢引用类型
├── core/
│   ├── renderer.ts     # 修改：阴影相机范围可能需要调整以覆盖起伏地形
│   └── world.ts         # 重写：地形生成改为带噪声起伏，实体 Y 坐标贴地
├── entities/
│   └── unit.ts          # 重写：模型改为分段几何体 + 程序化动画
└── systems/
    └── (不变)            # 玩法系统不动
```

**Structure Decision**: 单项目结构，所有改动集中在已有的 src/ 目录下，不新增模块。

## Design Decisions

### 1. 模型分段方案（P1）

**拓荒者模型**（约 120 三角面）：
- 头部：`SphereGeometry(0.22, 8, 6)` 球体
- 躯干：`CapsuleGeometry(0.32, 0.55, 4, 8)` 胶囊体（带收腰感）
- 帽子：保留现有 `CylinderGeometry`
- 上臂：`CapsuleGeometry(0.09, 0.28, 4, 6)` × 2（左右）
- 下臂：`CapsuleGeometry(0.08, 0.26, 4, 6)` × 2
- 大腿：`CapsuleGeometry(0.11, 0.3, 4, 6)` × 2
- 小腿：`CapsuleGeometry(0.09, 0.28, 4, 6)` × 2
- 工具：保留现有手斧模型，但挂在右手腕位置

**野狼模型**（约 100 三角面）：
- 身体：`CapsuleGeometry(0.28, 0.7, 4, 8)` 横放（绕 X 轴转 90°）
- 头：`SphereGeometry(0.2, 8, 6)` 前部
- 口鼻：`ConeGeometry(0.1, 0.25, 5)` 朝前
- 耳朵：`ConeGeometry(0.07, 0.18, 4)` × 2
- 四条腿：`CapsuleGeometry(0.06, 0.35, 4, 6)` × 4
- 尾巴：`ConeGeometry(0.06, 0.4, 5)` 向后上方翘起
- 眼睛：保留现有发光小方块

**关键**：所有四肢 mesh 必须保存引用到 unit 实例上，供动画驱动。

### 2. 地形起伏方案（P2）

**不引入外部噪声库**，用一个简单的伪随机值噪声函数：
```
function noise2D(x: number, z: number): number
```
基于多个正弦波叠加（频率递增、振幅递减），输出 -1 到 1 的值。

**实现方式**：保持现有的 tile 网格结构（不改成 PlaneGeometry），但：
- 每个 tile 的 Y 位置根据 `noise2D(gx, gz) * amplitude` 偏移
- tile 高度（Box 的 Y 方向尺寸）也微调，让相邻 tile 之间有缓坡过渡
- 新增 `groundHeightAt(x, z)` 函数，返回任意世界坐标处的地面 Y 值
- 所有实体（树、岩石、建筑、角色）生成时调用此函数设置初始 Y

**参数**（加进 config.ts）：
- `terrainAmp: 1.2` —— 起伏幅度（±1.2 米）
- `terrainFreq: 0.35` —— 噪声频率

### 3. 动画方案（P3）

**不引入动画库**，用主循环的 dt 驱动：

- 每个 unit 持有 `animT`（动画时间累计）和 `animState`（idle / walk / gather / attack）
- **走路动画**：`legL.rotation.x = sin(animT * speed) * 0.6`，`legR.rotation.x = sin(animT * speed + π) * 0.6`，手臂反相摆动，身体 Y 加 `abs(sin(...)) * 0.05` 起伏
- **采集动画**：右手臂 rotation.x 走一个 0 → -2.0 → 0 的循环（举过头顶再落下）
- **野狼跑动**：前后腿对角摆动（前左+后右同相，前右+后左反相）

**关键**：动画只在移动/工作状态播放，静止时回到 idle（四肢自然下垂）。

## Complexity Tracking

无宪法违规，不需要豁免。
