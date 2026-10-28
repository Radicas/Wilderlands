# Feature Specification: 背包与存档（Inventory & Save）

**Feature Branch**: `003-inventory-save`

**Created**: 2026-10-22

**Status**: Approved

**Input**: v0.3 方向确认（MainAgent 提案 + 用户确认）：把全局资源池 `bag` 重构为每人背包（物品类型化 + 容量限制），并落地本地存档/读档（localStorage + JSON 导出/导入 + 版本迁移）。P1 追加商人收购扩展与手动存档档位，P2 负重影响。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 每人一个背包，资源不再是公共池 (Priority: P0)

玩家选中任意一名拓荒者，能看到他个人携带的木材/石头/食物/种子/浆果数量与负重条；采集获得的资源进入"干活的那个人"的背包；派 A 砍树得到木头在 A 包里，B 包里没有。

**Why this priority**: 全局资源池让"谁带物资"没有决策空间，也是存档系统需要的数据基础。

**Independent Test**: 选中 A 砍 1 棵树后，A 背包木材 +3、B 背包木材不变；选中 B 看背包为空。

**Acceptance Scenarios**:

1. **Given** 游戏已启动、3 名拓荒者各有初始背包，**When** 左键选中 A，**Then** 选中面板显示 A 的个人背包（各物品数量 + 负重条），不是小队总量。
2. **Given** 已选中 A，**When** 右键 A 砍倒一棵树，**Then** 木材 +3 只进入 A 的背包，其他队员背包不变。
3. **Given** A 的背包已满（负重 100%），**When** 继续派 A 采集，**Then** 命令被拒绝并提示"背包已满"，资源不丢失、不加给任何人。

---

### User Story 2 - 背包物品可在队员间转移 (Priority: P0)

选中 A 后，可在其背包面板把物品转移给任意其他队员，或丢弃。转移后双方背包实时更新。

**Why this priority**: 容量限制下必须能倒腾物资，否则某个人满了整队卡死。

**Independent Test**: 选中 A，把 3 个木头转给 B，A 背包 -3、B 背包 +3。

**Acceptance Scenarios**:

1. **Given** A 背包有木头，**When** 在 A 的背包面板点"木头 →"并选择 B，**Then** A 木头 -1、B 木头 +1，双方负重更新。
2. **Given** 只有一名队员（其余全倒地/死亡），**When** 点"丢弃"，**Then** 物品消失且不产生任何资源。
3. **Given** B 负重已满，**When** 向 B 转移物品，**Then** 转移被拒绝并提示"目标背包已满"。

---

### User Story 3 - 进度可保存，刷新不丢档 (Priority: P0)

玩家点击存档按钮可将当前进度存入槽位（1 个自动槽 + 3 个手动槽）；读档后建筑、农田生长状态、队员位置/血量/背包/木矛、金币、时辰全部恢复，资源（树/岩石/浆果）重置为满状态。

**Why this priority**: "刷新即丢进度"是当前最大体验短板，沙盒"扎下根"的承诺需要持久化支撑。

**Independent Test**: 建一栋木屋、种 2 块田、让 A 背 5 木头，存档后刷新页面再读档，木屋在、农田状态在、A 背包 5 木头在。

**Acceptance Scenarios**:

1. **Given** 玩家建造了木屋/围栏、种了农田、队员各有背包，**When** 存档到槽位 1，**Then** 数据写入 localStorage 且存档面板显示"已保存 HH:MM"。
2. **Given** 已存档，**When** 刷新页面（页面重载），**Then** 从该槽位读档后，建筑/农田/队员位置/背包/金币/时辰与存档时刻一致。
3. **Given** 存档包含 `version: 1`，**When** 程序读到更高版本或不认识的结构，**Then** 明确提示"存档版本不兼容"并拒绝读取，不损坏其他槽位。

---

### User Story 4 - 存档可导出/导入 JSON (Priority: P0)

存档面板提供"导出 JSON"与"导入 JSON"：导出下载一个 `.json` 文件，导入从本地文件恢复进度，可在不同浏览器/设备间迁移存档。

**Why this priority**: localStorage 是浏览器本地，导出/导入是"进度属于玩家"的兜底（宪法 I 纯前端零后端下的唯一迁移通道）。

**Independent Test**: 导出存档文件，清空 localStorage 后导入，进度完整恢复。

**Acceptance Scenarios**:

1. **Given** 已存档，**When** 点击"导出 JSON"，**Then** 浏览器下载 `wilderlands-save-<时间戳>.json`，内容为合法 JSON 且含 `version` 字段。
2. **Given** 一个合法的存档 JSON 文件，**When** 点击"导入 JSON"并选择该文件，**Then** 导入成功后刷新并按该存档初始化游戏。
3. **Given** 一个损坏/非 JSON/版本不符的文件，**When** 尝试导入，**Then** 提示导入失败原因，游戏状态不受影响。

---

### User Story 5 - 商人收购木材与石头 (Priority: P1)

贸易站新增"出售木材（1 金/个）"与"出售石头（1 金/个）"，从当前选中角色的背包扣除。

**Why this priority**: 经济闭环目前只有食物一个出口，采集物囤积无意义；多出口让"采集→出售"成立。

**Independent Test**: 选中背有木材的 A 打开贸易站，出售 1 木头，金币 +1、A 木材 -1。

**Acceptance Scenarios**:

1. **Given** A 背包有木材，**When** 打开贸易站点"出售木材"，**Then** 金币 +1、A 木材 -1，面板刷新。
2. **Given** 未选中任何角色，**When** 打开贸易站尝试买卖，**Then** 提示"先选中一名拓荒者再交易"。

---

### User Story 6 - 负重影响移动速度 (Priority: P2)

背包负重超过 80% 的角色移动速度降为 80%，给"带多少物资"加决策分量。

**Why this priority**: 容量本身只是上限约束，负重减速让超载有真实代价。

**Independent Test**: 塞满 A 的背包后下达移动命令，A 明显比未超载的 B 慢。

**Acceptance Scenarios**:

1. **Given** A 负重 < 80%，**When** 移动，**Then** 速度正常。
2. **Given** A 负重 ≥ 80%，**When** 移动，**Then** 移动速度 ×0.8，背包面板负重条变色提示超载。

---

### Edge Cases

- 转移/丢弃后负重立即重算，不做"溢出到地上"的掉落物。
- 采集时背包差 1 就满：本次采集应拒绝（不产生半份资源）。
- 全队背包都满时，贸易站"购买种子"应拒绝并提示先腾位置。
- 读档时队员数可能 < 3（存档前有人死亡？当前版本玩家不会死，倒地会恢复；仍按存档数量恢复）。
- 存档写入失败（localStorage 满/隐私模式）：提示保存失败，不中断游戏。
- 自动存档与手动存档互不覆盖（不同槽位 key）。
- 导入 JSON 后立即读档：需要先刷新页面再按该档初始化（避免就地重建场景的复杂性与风险）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 每个拓荒者 MUST 拥有独立背包 `Inventory`（`Partial<Record<ItemId, number>>`），金币为小队公共货币不进背包。
- **FR-002**: 采集（树/岩石/作物/浆果）产出 MUST 进入执行采集的角色背包；背包容量不足时 MUST 拒绝本次采集并提示。
- **FR-003**: 建造/播种/进食/出售 MUST 从发起指令的选中角色背包扣除对应资源；公共金币用于招募与购买。
- **FR-004**: 背包面板 MUST 支持把物品转移给其他任意队员或丢弃，转移前后双方数据实时一致。
- **FR-005**: 存档数据 MUST 包含 `version` 字段（当前 v1），结构含：金币、时辰、队员（位置/血量/饥饿/背包/木矛/攻击力）、建筑（类型+位置）、农田（坐标+状态+生长进度）、流浪者状态。
- **FR-006**: 存档 MUST 提供 1 个自动槽（每 60 秒静默保存）与 3 个手动槽；读档采用"写入待读标记 → 页面重载 → 启动时按存档初始化"流程。
- **FR-007**: 读档后树/岩石/浆果 MUST 重置为满状态重新生成（资源自我修复），建筑/农田/队员/金币/时辰 MUST 与存档一致。
- **FR-008**: 版本迁移 MUST 有 `migrate()` 入口（当前只有 v1，直接透传；未来加字段在迁移函数内处理）。
- **FR-009**: 导出 JSON MUST 触发文件下载（`<a download>` + Blob）；导入 MUST 校验 JSON 结构与版本，失败时明确报错且不影响当前游戏。
- **FR-010**: 负重 ≥ 80% 时角色移动速度 MUST ×0.8（P2）。
- **FR-011**: 商人 MUST 新增收购木材 1 金/个、石头 1 金/个（P1），从选中角色背包扣除。

### Key Entities

- **背包 Inventory**: `Partial<Record<ItemId, number>>` + 容量上限（`inventoryCap`，默认 40 单位）；每种物品有 `weight`（wood/stone 2，food/seed/berry 1）。
- **公共货币 gold**: 替换原 `bag.gold`，小队共享，不占负重。
- **存档槽位**: `wilderlands.save.auto` + `wilderlands.save.manual1..3`；`wilderlands.save.pending` 存"待读档"标记。
- **存档数据 SaveData**: `{ version, savedAt, gold, time, units[], buildings[], tiles[], wanderer }`。
- **读档流程**: `saveRequest(slot)` → 写 pending → `location.reload()` → `main.ts` 读 pending → `initGame(parsed)`。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 采集产出只进干活者的背包；背包满时采集被拒绝且无资源凭空产生。
- **SC-002**: 转移/丢弃后两个背包与负重条立即正确（可复核：转 3 木头，A -3、B +3）。
- **SC-003**: 存档→刷新→读档后，建筑数量/农田状态/队员背包/金币/时辰与存档时刻逐项一致（可复核清单）。
- **SC-004**: 导出文件可被导入恢复；损坏文件被拒绝且游戏不受影响。
- **SC-005**: 经济闭环仍可复算（种子 2 金 → 收 2 食物 → 卖 6 金），新增木材/石头出口（1 金/个）不破坏原闭环。
- **SC-006**: `tsc --noEmit` 0 错误、`vite build` 通过、实机验证（`?debug=1` 通道）背包读写与存档/读档全链路正常。

## Assumptions

- 金币为公共货币不进背包、不占负重；只对"资源物品"做容量限制。
- 读档采用"重载页面 + 启动时初始化"，不做运行时清场景重建（避免 interMeshes/selectableMeshes 清理风险）。
- 树/岩石/浆果位置读档后重新随机生成，不恢复"哪棵被砍了"——荒野自我修复，符合沙盒叙事。
- 野狼不存档（读档后按当前时间节奏重新刷新 2~3 只）。
- 背包不做"格子"，做"物品类型 + 数量 + 总容量"（物品行聚合式），UI 按物品行展示。
- 转移交互：点物品行的"→"弹出队员选择浮层（含丢弃），一次转移 1 个。
