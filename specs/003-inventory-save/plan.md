# Implementation Plan: 背包与存档

**Branch**: `003-inventory-save` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-inventory-save/spec.md`

## Summary

把全局资源池 `bag` 重构为"小队公共金币 + 每人背包（物品类型化、容量限制、负重）"，新增背包转移 UI 与本地存档/读档系统（localStorage 自动槽 + 3 手动槽 + JSON 导出/导入 + 版本迁移），并扩展商人收购（木材/石头）。读档采用"写待读标记 → 重载页面 → 启动时按存档初始化"流程，避开运行时清场景的高风险路径。

## Technical Context

**Language/Version**: TypeScript 5.5

**Primary Dependencies**: Three.js 0.160（已安装）、Vite 5、无新增依赖

**Storage**: `localStorage`（键：`wilderlands.save.auto` / `manual1..3` / `pending`），JSON 导出走 Blob + `<a download>`

**Testing**: `tsc --noEmit` + `vite build` + 实机验证（`?debug=1` 状态通道 + 存档/读档全链路）

**Target Platform**: 现代桌面浏览器（WebGL）

**Project Type**: 纯前端 3D 沙盒游戏原型

**Performance Goals**: 背包/存档逻辑不进入主循环热路径（自动存档 60 秒一次，序列化 < 5ms）

**Constraints**: 宪法 I 纯前端零后端（无网络请求、dist 可静态托管）；宪法 II 数值全部进 config.ts；宪法 III 分层（systems 不碰渲染、ui 不直接改世界状态）；宪法 IV 严格模式 0 错误

**Scale/Scope**: 修改 10 个源文件 + 新增 2 个系统模块（inventory.ts、save.ts）+ 新增 1 个 UI 模块（save.ts），预计新增约 500-600 行

## Constitution Check

| 宪法原则 | 是否通过 | 说明 |
|---|---|---|
| I. 纯前端零后端 | ✅ | localStorage + Blob 下载，零网络请求，dist 可静态托管 |
| II. 单一数值数据源 | ✅ | 物品定义/容量/价格/存档间隔/负重阈值全部加进 `config.ts` |
| III. 模块化分层 | ✅ | 背包逻辑进 `systems/inventory.ts`，存档进 `systems/save.ts` + `ui/save.ts`，玩法系统只调接口 |
| IV. TypeScript 严格模式 | ✅ | 新类型集中在 types.ts，`any` 不新增；`tsc --noEmit` 0 错误 |
| V. 性能与渲染纪律 | ✅ | 存档序列化 60 秒一次，不碰主循环；转移/负重 O(物品类型数) |

**结论**：全部通过，无需豁免。

## Project Structure

### Documentation (this feature)

```text
specs/003-inventory-save/
├── spec.md              # 需求规格
├── plan.md              # 本文件
└── tasks.md             # 任务拆解
```

### Source Code (repository root)

```text
src/
├── config.ts            # 新增：物品定义/容量/价格/存档参数/负重阈值
├── types.ts             # 新增：ItemId / Inventory / SaveData / UnitSave；Unit 加 inv/背包字段
├── state.ts             # 重构：bag → gold（公共货币）+ 存档待读标记
├── main.ts              # 重构：initGame(save?) 支持读档初始化；自动存档调度
├── core/                # （不变）
├── entities/
│   └── unit.ts          # 修改：inv 字段、采集/狼杀入包、takeDamage(attacker)、负重减速
├── systems/
│   ├── inventory.ts     # 新增：物品查询/总量/容量/转移/增删
│   ├── save.ts          # 新增：序列化/反序列化/迁移/槽位/导出导入
│   ├── farm.ts          # 修改：plantTile(tile, from)
│   ├── build.ts         # 修改：buildFence/buildHouse(p, from)
│   ├── economy.ts       # 修改：eatFood 从选中角色背包扣
│   └── commands.ts      # 修改：采集/建造/播种传发起者；招募扣公共金币
└── ui/
    ├── hud.ts           # 修改：资源栏=金币+小队合计；选中面板个人背包+负重+转移
    ├── trade.ts         # 修改：买卖从选中角色背包；新增收购木材/石头
    └── save.ts          # 新增：存档菜单（槽位/导出/导入）
```

## Design Decisions

### 1. 物品与背包模型（P0）

```ts
export type ItemId = 'wood' | 'stone' | 'food' | 'seed' | 'berry';
export type Inventory = Partial<Record<ItemId, number>>;

// config.ts
export const ITEMS = {
  wood:  { label: '木材', weight: 2 },
  stone: { label: '石头', weight: 2 },
  food:  { label: '食物', weight: 1 },
  seed:  { label: '种子', weight: 1 },
  berry: { label: '浆果', weight: 1 },
} as const;
inventoryCap: 40,          // 每人容量（单位）
overloadRatio: 0.8,        // 超载阈值
overloadSlow: 0.8,         // 超载减速系数
```

- **金币不进背包**：`state.gold` 小队公共货币（招募/买种子/买木矛用），不占负重。原 `bag` 删除，全部引用改为 `gold` / `u.inv`。
- **容量 = Σ(数量 × weight)**，不做格子；堆叠不设上限，容量即总量约束。
- `systems/inventory.ts` 提供纯函数：`invTotal(inv)`、`invAdd(u, id, n)`、`invRemove(u, id, n)`、`canCarry(u, id, n)`、`transferItem(from, to, id, n)`。所有"加/扣/转"都过这一层，保证容量与负重一致。

### 2. 玩法接入规则（P0）

| 动作 | 资源来源/去向 | 实现点 |
|---|---|---|
| 砍树/凿石/收作物/采浆果 | 产物进执行者 `this.inv`；满则拒绝本次采集 | `unit._finishGather` |
| 击杀野狼 | 食物 +2 进攻击者 `inv` | `takeDamage(dmg, attacker?)`，狼死时 `attacker.inv.food += 2` |
| 建造围栏/木屋 | 从 `selected[0]` 背包扣 wood/stone | `buildFence(p, from)` |
| 播种 | 从 `selected[0]` 背包扣 seed | `plantTile(tile, from)` |
| 进食 F | 从 `selected[0]` 背包扣 food，喂所有选中者 | `eatFood()` |
| 招募 | 扣公共 `gold` | `commands.ts` |
| 出售食物/木材/石头 | 从 `selected[0]` 背包扣，金币入公共 | `trade.ts` |
| 购买种子/木矛 | 种子进 `selected[0]` 背包，木矛装备 `selected[0]`，金币从公共扣 | `trade.ts` |

- `selected[0]` 为空（全倒地）时各入口提示"先选中一名拓荒者"。

### 3. 存档数据（P0）

```ts
interface SaveDataV1 {
  version: 1;
  savedAt: string;          // ISO 时间
  gold: number;
  time: number;             // 昼夜 t
  units: UnitSave[];        // { name, x, z, hp, hunger, hasSpear, atkDmg, inv }
  buildings: { type: 'fence' | 'house'; x: number; z: number }[];
  tiles: { x: number; z: number; state: TileState; grow: number }[];
  wanderer: { available: boolean; respawn: number } | null;
}
type SaveData = SaveDataV1;
```

- **不存**：树/岩石/浆果状态（读档后重置重新生成）、野狼（读档后按时间刷）、选中状态。
- **迁移**：`migrateSave(raw): SaveData | null` —— 当前只接受 `version === 1`；`version > 1` 返回 null 并提示不兼容。未来 v2 在此函数内逐级迁移。

### 4. 读档流程（P0，核心可靠性决策）

```
saveGame(slot)      → 收集状态 → localStorage 写槽位 → 存档面板提示"已保存"
saveRequest(slot)   → 写 localStorage['wilderlands.save.pending'] = slot → location.reload()
main.ts 启动        → 读 pending：
                       ├─ 无 → initGame(undefined)（默认开局）
                       └─ 有 → 解析 + migrateSave 校验 → initGame(save)；成功后清 pending
```

- **为什么重载而不是运行时清场景**：运行时重建需要清理 `scene` 中全部动态对象 + `interMeshes`/`selectableMeshes` 数组 + 各系统闭包状态（wolfSpawnT、respawn 计时等），清理不全即泄漏/幽灵实体；重载是确定性最高、最可测试的路径，代价是 1 秒闪断（可接受）。
- **自动存档**：每 60 秒静默写入自动槽（`setInterval` 在 main.ts，保存函数在 save.ts）；自动槽可被手动读，也可被手动槽覆盖读。
- 世界生成流程保持：`buildGround → buildTrees → buildRocks → buildBerries → buildMerchant → buildWanderer`，然后 `initGame(save)` 里按存档恢复玩家侧状态（建筑重建、tiles 恢复、队员创建、金币/时间/流浪者）。

### 5. 存档 UI（P0+P1）

右上角新增"菜单"按钮 → modal：
- 4 个槽位卡片（自动 / 手动 1-3）：每张显示"保存 / 读取"，有存档则显示时间。
- 按钮：导出 JSON（下载文件）、导入 JSON（`<input type=file>`）。
- 导入成功 → 写 pending → 重载。
- 样式沿用现有 `.panel` 视觉语言（深色半透明 + 金色强调）。

### 6. 商人收购与负重（P1 + P2）

- config：`woodSell: 1`、`stoneSell: 1`；trade 面板新增两行"出售木材/石头"（从 `selected[0]` 扣，逻辑与卖食物同构）。
- 负重：`moveToward` 内 `slow` 额外乘 `(invTotal(u.inv) / capacity > overloadRatio ? overloadSlow : 1)`；HUD 负重条 ≥80% 变橙提示。

## Complexity Tracking

- 全量 `bag` 引用迁移是本次最大风险点（约 15 处引用分布在 9 个文件），通过"先改 state/inventory 提供新接口 → 逐个文件编译驱动修改"控制。
- 读档用重载方案规避场景重建风险；存档序列化不进入主循环。
- 无宪法违规，不需要豁免。
