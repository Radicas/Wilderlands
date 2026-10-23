# Tasks: 背包与存档

**Input**: Design documents from `/specs/003-inventory-save/`

**Prerequisites**: plan.md, spec.md

**Tests**: `tsc --noEmit` + `vite build` + 实机验证（`?debug=1` 状态通道 + 存档/读档全链路）

**Organization**: Phase 0 数据模型 → Phase 1 玩法接入 → Phase 2 UI → Phase 3 存档 → Phase 4 收尾

## Format: `[ID] [P?] [Story] Description`

---

## Phase 0: 数据模型与背包模块（共享基础设施）

**Purpose**: 所有故事依赖的公共数据层

- [ ] T001 [P0] 在 `src/config.ts` 新增：`ITEMS` 物品定义（wood/stone weight 2，food/seed/berry weight 1 + label）、`inventoryCap: 40`、`woodSell: 1`、`stoneSell: 1`、`saveAutoInterval: 60`、`overloadRatio: 0.8`、`overloadSlow: 0.8`；把 `START_BAG` 改为 `START_INV`（每人初始 wood 3 / stone 2 / food 3 / seed 1）+ 公共 `START_GOLD: 20`
- [ ] T002 [P0] 在 `src/types.ts` 新增 `ItemId`、`Inventory`、`UnitSave`、`SaveData`（v1 结构）；`Unit` 接口新增 `inv: Inventory`、`capacity: number`、`atkDmg/hasSpear/equipSpear`（已有）
- [ ] T003 [P0] 在 `src/state.ts` 重构：删除 `bag`，新增 `gold: number`（公共货币）+ `savePending` 读写函数（localStorage `wilderlands.save.pending`）
- [ ] T004 [P0] 新增 `src/systems/inventory.ts`：`invTotal(inv)`、`invCanAdd(u, id, n)`、`invAdd(u, id, n)`、`invRemove(u, id, n)`、`transferItem(from, to, id, n)`（含容量校验），全部返回 boolean 且带提示

**Checkpoint**: `tsc --noEmit` 通过，`bag` 相关旧引用全部暴露

---

## Phase 1: 玩法系统接入背包

**Goal**: 所有资源产出/消耗走背包，公共金币只用于货币

- [ ] T005 [US1] `src/entities/unit.ts`：新增 `inv` 字段（构造时用 `START_INV` 克隆，第 4 名招募队员空背包）；`_finishGather` 各分支产物改为 `invAdd(this, ...)`，背包满时拒绝本次采集（不消耗、不产出）
- [ ] T006 [US1] `src/entities/unit.ts`：`takeDamage(dmg, attacker?)` 增加攻击者参数；狼死时食物 +2 进 `attacker.inv`；`moveToward` 负重超载减速（P2）
- [ ] T007 [US1] `src/systems/farm.ts`：`plantTile(tile, from)` 从 `from.inv` 扣 seed
- [ ] T008 [US1] `src/systems/build.ts`：`buildFence(p, from)` / `buildHouse(p, from)` 从 `from.inv` 扣 wood/stone
- [ ] T009 [US1] `src/systems/economy.ts`：`eatFood()` 从 `selected[0].inv` 扣 food
- [ ] T010 [US1] `src/systems/commands.ts`：`commandAt` 采集/播种/建造分支传 `selected[0]` 为 `from`；招募改扣公共 `gold`；各分支补"未选中/背包不足"提示
- [ ] T011 [US1] `src/main.ts`：debug 钩子输出改为 `gold` + 小队背包合计 + 每人背包

**Checkpoint**: `tsc --noEmit` 0 错误；实机 `?debug=1` 可见金币与各队员背包

---

## Phase 2: 背包 UI 与商人收购

**Goal**: 玩家能查看/转移背包，商人多两个收购出口

- [ ] T012 [US2] `src/ui/hud.ts`：资源栏改为"金币 + 小队合计（wood/stone/food/seed/berry 汇总）"；选中面板新增背包区：每物品一行（label × 数量 + [→] 按钮）+ 负重条（≥80% 变橙）
- [ ] T013 [US2] `src/ui/hud.ts`：实现转移交互——点 [→] 弹出队员选择浮层（其他全部队员 + 丢弃），点击后 `transferItem(from, to, id, 1)`，浮层消失
- [ ] T014 [P1] `src/ui/trade.ts` + `index.html`：贸易面板新增"出售木材 1 金/个""出售石头 1 金/个"两行（从 `selected[0]` 背包扣）；买卖入口统一补"未选中"提示
- [ ] T015 [P1] `src/ui/hud.ts`：负重条与容量文案（"12/40"）

**Checkpoint**: 实机验证转移 3 木头 A -3/B +3；出售木材金币 +1

---

## Phase 3: 存档 / 读档系统

**Goal**: 进度可保存、刷新可恢复、可导出迁移

- [ ] T016 [P0] 新增 `src/systems/save.ts`：`collectSave()` 收集状态 → SaveData v1；`applySave(save)` 启动时按存档初始化（建筑重建、tiles 恢复、队员创建、金币/时间/流浪者恢复）；`migrateSave(raw)` 校验 version；`saveToSlot(slot)` / `readSlot(slot)` / `saveRequest(slot)`（写 pending + reload）
- [ ] T017 [P0] `src/main.ts`：重构为 `initGame(save?)` —— 世界生成 → `applySave(save)` 或默认开局 → 创建 3 人；启动时读 pending 决定 init 参数；`setInterval` 自动存档（60s → 自动槽）
- [ ] T018 [P0] 新增 `src/ui/save.ts` + `index.html`：右上"菜单"按钮 → modal：自动槽 + 手动 1-3 槽卡片（保存/读取/时间戳）、导出 JSON（Blob 下载）、导入 JSON（file input → 校验 → pending + reload）
- [ ] T019 [P0] `src/main.ts`：`initGame` 内恢复队员时调用 `equipSpear` 视觉同步（hasSpear 存档恢复）

**Checkpoint**: 存档 → 刷新 → 读档，建筑/农田/背包/金币/时辰逐项一致；导出文件可重新导入

---

## Phase 4: 收尾验证与文档

- [ ] T020 [P] 全量验证：`tsc --noEmit` 0 错误、`vite build` 通过
- [ ] T021 [P] 实机验证清单：背包采集入包 / 满拒采 / 转移 / 出售木材石头 / 存档读档全链路（`?debug=1` 通道 + 截图 OCR）
- [ ] T022 [P] 更新 `README.md`：玩法闭环（背包/存档/商人收购）、操作说明、调试钩子、验证状态
- [ ] T023 [P] 更新 `docs/DESIGN.md`：v0.3 系统设计（4.x 背包与存档小节）、数值表、路线图勾选
- [ ] T024 [P] Edge case 复查：读档后农田生长继续、招募第 4 人空背包、负重超载减速、全队满包提示

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0**: 无依赖，立即开始
- **Phase 1**: 依赖 Phase 0（数据模型就绪后逐个文件迁移）
- **Phase 2**: 依赖 Phase 1（背包数据可用）
- **Phase 3**: 依赖 Phase 0/1（存档依赖最终数据形态），可与 Phase 2 部分并行（save.ts 独立模块）
- **Phase 4**: 依赖全部

### 建议执行顺序

1. T001 → T002 → T003 → T004（数据模型 + 背包模块）
2. T005 → T006（unit 背包化）→ T007 ~ T010（各系统迁移）→ T011（debug 更新）
3. T012 → T013（背包 UI）→ T014 → T015（商人收购 + 负重文案）
4. T016 → T017 → T018 → T019（存档三件套 + 菜单）
5. T020 → T021 → T022 → T023 → T024（收尾）

### 并行机会

- T014（trade 收购）与 T016（save 模块）不同文件可并行。
- T012/T013（hud 背包）与 T016（save 模块）不同文件可并行。
