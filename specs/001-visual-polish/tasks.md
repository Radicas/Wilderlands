# Tasks: 视觉精细化升级

**Input**: Design documents from `/specs/001-visual-polish/`

**Prerequisites**: plan.md, spec.md

**Tests**: 手动验证（headless 像素采样 + tsc + build）

**Organization**: 按用户故事分组，P1 → P2 → P3 顺序交付

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational (共享基础设施)

**Purpose**: 所有用户故事都依赖的公共改动

- [ ] T001 [P] 在 `src/config.ts` 新增地形参数（`terrainAmp: 1.2`、`terrainFreq: 0.35`）和动画参数（`walkAnimSpeed: 6`、`gatherAnimSpeed: 5`）
- [ ] T002 [P] 在 `src/types.ts` 新增动画状态类型 `AnimState = 'idle' | 'walk' | 'gather' | 'attack'`，以及四肢引用接口 `LimbRefs`（head/torso/armL/armR/legL/legR/forearmL/forearmR/calfL/calfR）
- [ ] T003 在 `src/core/world.ts` 实现 `groundHeightAt(x: number, z: number): number` 噪声函数 + 地面高度查询，供所有实体贴地使用

**Checkpoint**: 公共参数和工具函数就绪

---

## Phase 2: User Story 1 - 角色与野狼造型更自然 (Priority: P1) 🎯 MVP

**Goal**: 拓荒者和野狼模型从方块堆叠改为分段几何体组合，轮廓更自然

**Independent Test**: 拉近观察角色和野狼，能分辨出头、躯干、四肢分段，形状不再是纯方块；帧率无明显下降

### Implementation for User Story 1

- [ ] T004 [US1] 重写 `src/entities/unit.ts` 中拓荒者模型构建：头改为 SphereGeometry、躯干改为 CapsuleGeometry、四肢改为分段 CapsuleGeometry（上臂/下臂、大腿/小腿），所有四肢 mesh 保存到 `this.limbs` 引用
- [ ] T005 [US1] 重写 `src/entities/unit.ts` 中野狼模型构建：身体横放 CapsuleGeometry、头+口鼻+四腿+尾巴，保存四肢引用到 `this.limbs`
- [ ] T006 [US1] 保留现有帽子、工具、耳朵、眼睛、选中标记等装饰件，挂载到新模型对应位置
- [ ] T007 [US1] 调整模型整体 scale 和位置，保证脚底仍然在 Y=0 附近、碰撞/交互距离不变
- [ ] T008 [US1] 验证：`tsc --noEmit` 0 错误，`vite build` 通过，同屏 3人+6狼 帧率不下降

**Checkpoint**: 模型造型升级完成，可独立演示

---

## Phase 3: User Story 2 - 地形有自然起伏 (Priority: P2)

**Goal**: 平坦地面改为有缓坡起伏，所有实体贴合地面

**Independent Test**: 移动镜头能看到地面高低差，所有实体（人、树、岩石、建筑）底部贴合地面无悬浮

### Implementation for User Story 2

- [ ] T009 [US2] 修改 `src/core/world.ts` 的 `buildGround()`：每个 tile 的 Y 位置根据 `groundHeightAt(gx, gz)` 偏移，tile 高度也做 ±0.1 的微调让相邻地块过渡更自然
- [ ] T010 [US2] 修改 `buildTrees()`：每棵树生成时调用 `groundHeightAt()` 设置 Y 坐标
- [ ] T011 [US2] 修改 `buildRocks()`：每块岩石生成时调用 `groundHeightAt()` 设置 Y 坐标
- [ ] T012 [US2] 修改 `buildMerchant()`：贸易站整体 Y 坐标跟随所在地高度
- [ ] T013 [US2] 修改 `src/entities/unit.ts` 构造函数：角色出生时 Y 坐标调用 `groundHeightAt()` 贴地
- [ ] T014 [US2] 修改 `src/systems/build.ts`：放置围栏/木屋时 Y 坐标贴地（需先读该文件确认当前实现）
- [ ] T015 [US2] 调整 `src/core/renderer.ts` 中阴影相机范围（left/right/top/bottom），确保起伏地形不超出阴影贴图范围
- [ ] T016 [US2] 验证：地形起伏可见，所有实体无悬浮/穿模，阴影覆盖正常

**Checkpoint**: 地形起伏完成，可独立演示

---

## Phase 4: User Story 3 - 动作动画更生动 (Priority: P3)

**Goal**: 走路四肢摆动、采集挥砍动作、野狼跑动姿态

**Independent Test**: 下达移动命令能看到走路动画；砍树能看到挥砍循环；野狼冲过来有跑动姿态

### Implementation for User Story 3

- [ ] T017 [US3] 在 `unit.ts` 新增 `animT: number` 字段和 `animState: AnimState` 字段
- [ ] T018 [US3] 实现走路动画：在 `moveToward()` 返回 true 时，根据 `animT` 驱动左右腿 rotation.x 交替摆动、手臂反相摆动、身体轻微上下起伏；静止时四肢回到自然角度
- [ ] T019 [US3] 实现采集动画：在 `_workAnim()` 中，右手臂做举过头顶再落下的循环动作（而非现在的躯干小幅旋转）
- [ ] T020 [US3] 实现野狼跑动：四腿对角摆动（前左+后右同相，前右+后左反相），身体轻微起伏
- [ ] T021 [US3] 确保倒地（down）和选中标记旋转不受新动画影响
- [ ] T022 [US3] 验证：走路/采集/野狼跑动动画自然，无抽搐或穿模，静止时回到 idle

**Checkpoint**: 动画升级完成

---

## Phase 5: Polish & 收尾

- [ ] T023 [P] 全量验证：`tsc --noEmit` 0 错误、`vite build` 通过、headless 像素采样确认渲染正常
- [ ] T024 [P] 同屏满载性能测试：3人+6狼+46树+22岩石+建筑，帧率下降 ≤5%
- [ ] T025 [P] 更新 `README.md` 操作方式和玩法说明（如有变化）
- [ ] T026 [P] 检查并修复 edge case：倒地姿态、建筑放置、农田交互在起伏地形上的表现

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Foundational)**: 无依赖，立即开始
- **Phase 2 (US1 模型造型)**: 依赖 Phase 1
- **Phase 3 (US2 地形起伏)**: 依赖 Phase 1，可与 US1 并行（不同文件为主）
- **Phase 4 (US3 动画)**: 依赖 US1（需要四肢引用已存在）
- **Phase 5 (Polish)**: 依赖全部三个 US 完成

### 建议执行顺序

1. T001 → T002 → T003（基础设施）
2. T004 → T005 → T006 → T007 → T008（P1 模型造型，先做）
3. T009 → T010~T016（P2 地形起伏）
4. T017 → T018~T022（P3 动画）
5. T023 → T024 → T025 → T026（收尾验证）

### 并行机会

- T001 和 T002 可并行（不同文件）
- T010~T013（树/岩石/商人/角色贴地）可在 T009 完成后并行
