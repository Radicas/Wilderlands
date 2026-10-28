# v0.4 · 技能熟练度（S1+S2）规格

> 版本：v0.4 · 状态：已实现并回归（2026-10-22）
> 说明：本规格为补记（S1 按"自动选择内容"直接实现后补档），记录已落地的决策，供后续 S3/S4/S5 引用。

## 1. 目标

让拓荒者从"工具人"变为"可养成角色"：干活长熟练度，熟练度升等级，等级给数值加成。与 v0.3 背包/存档自然衔接（存档升 v2 携带技能字段）。

## 2. 数值设计（全部在 `src/config.ts`，单一数值源）

| 技能 | 经验来源（每次动作 +1） | 每级加成 | 封顶 |
| --- | --- | --- | --- |
| 采集 gather | 砍树 / 凿石 / 采浆果完成 | 负重上限 +4（容量 40→44→48…） | Lv5（+20） |
| 战斗 combat | 击杀野狼（+3/只） | 攻击 +1 | +4 |
| 种田 farm | 播种 / 收获作物 | 收获食物 +1 | +2 |

- 等级阈值表（三技能共用）：`skillXPForLevel = [3, 8, 15, 25, 40]`，Lv0..Lv5 封顶。
- 跨级提示：`gainSkill` 跨级时日志「XX 的采集升到了 Lv2！」。

## 3. 数据模型与存档迁移

- `Unit.skills: Skills`（`Record<'gather'|'combat'|'farm', number>` 存**经验值**）。
- 存档版本 **v1 → v2**（`SAVE_VERSION = 2`）：
  - 新档 `collectSave` 写 `version:2` + 每人 `skills`。
  - 旧 v1 档（无 skills）经 `migrateSave` 补默认 `{gather:0,combat:0,farm:0}` 后进入游戏，不炸、旧数据全保留。
  - `src/systems/migrate.ts` 为纯函数（无 DOM/three），可被 node 自动回归。

## 4. 模块与接线

- `src/systems/skills.ts`：`skillLevel`（阈值查表）/`skillOf`/`gainSkill`/`capacityBonus`/`atkBonus`/`harvestBonus`/`emptySkills`。纯函数（log 依赖抽到 `src/systems/log.ts`），可 node 测试。
- 经验点：`unit.ts` 砍树/凿石/采浆果 +1 gather；收获作物 +1 farm；野狼死亡击杀者 +3 combat；`farm.ts` 播种 +1 farm。
- 加成生效：负重上限在构造与**读档时按技能重算**（`save.ts` applySave 内 `u.capacity = CFG.inventoryCap + capacityBonus(u)`，修复"读档后容量不回算"）；攻击 `atkDmg + atkBonus(this)`；收获 `cropPerHarvest + harvestBonus(this)`。
- HUD：选中面板新增技能行「采集 LvX　战斗 LvX　种田 LvX」；`?debug=1` 面板新增每人「采X 战X 田X」经验直显。

## 5. 回归与验证

- `scripts/regress.sh`（5 步）：tsc → vite build → 产物断言 → 存档迁移自检（10 用例）→ 技能数值自检（24 用例：阈值/加成/封顶）。
- 实机：新档 version2 含 skills；v1 旧档读档恢复全部数据（gold77/背包/时辰/补狼）；导入 gather3 档读档后罗恩 14/44（负重 +4 生效）、技能经验正确恢复。

## 6. 后续（未做，S3+）

- 技能等级在 HUD 高亮/进度条（当前仅文本）；技能升级动画；练级节奏平衡（阈值按实机手感调整）。
