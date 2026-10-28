# Proposal

## Why

玩家实玩反馈森林三件事：**①树种单一**——220 株树共用一套"圆锥冠+圆柱干"几何，满屏同一种"松树"，世界观感单调；**②密度过高**——纯环形随机撒点、无最小间距，局部成团挤死，穿行与寻找采集点都发闷；**③没有生长阶段**——砍倒 45 秒后"满身位弹回"一棵一模一样的成树，森林不会呼吸，采集失去可持续感。三条共同指向：**让森林从静态贴图变成有生态的内容层**（上轮 gather-feedback 给了收获反馈，本轮给资源本体以生命）。

## What Changes

- **ADDED 树种三形态**：松树（基准锥冠，50%）、橡树（双球叠冠，木 4 · 工时 2.8s · 成材最慢）、白桦（细长白干小冠，木 2 · 工时 1.8s · 成材最快）。树种占比与属性进 `config.TREES` 单一来源；每树种的干/冠各一组 InstancedMesh（2 → 6 draw call，仍 O(1) 批次）
- **MODIFIED 密度与分布**：`treeCount 220 → 150`（−32%），新增**最小间距 3.2m** 拒绝采样（两轨同一规则），疏密观感立刻松动
- **ADDED 生长三阶段**：幼苗 → 小树 → 成树。砍倒不再"原地满血复活"，而是留桩 15s 后冒**幼苗**，按树种总时长（松 45 / 桦 30 / 橡 70s 成材）逐级放大；**仅成树可砍**，幼树右键被拒并提示，tooltip 显示"树种·阶段"
- **MODIFIED 收获结算按树种**：`woodPerTree/workDur/成材时长`从树种表读取（松保持现值 3/2.2s 作回归锚）；物品仍统一为"木材"（不引入松木/硬木——贸易与背包复杂度不扩大，留待后续玩法 change）
- sim 有镜像义务（世界生成/生长计时/采集拒绝是规则层）：树**位置不存盘**（现状两轨各自重建），**存档 schema 不变，SAVE_VERSION 保持 5**；物种用确定性索引映射（i%4）注入，生长阶段为新增计时字段（`respawn` 语义从"重生倒计时"改为"树桩期倒计时"，两轨一致）
- 测试基线随世界生成参数合理搬迁：`treeCount/间距`改变 sim 的 Rng 流与树数断言口径，163 哨兵与 G4/G16/G21 同刀适配，另加 G23 森林生态组

## Impact

- **Affected capabilities**: `world-generation`（树分布规则）、`resource-harvest`（按树种结算与阶段门）、新增 `forest-growth`（三阶段生态）
- Affected code: `src/config.ts`（TREES/WORLD）、`src/core/world.ts`（多树种 IM+间距采样）、`src/systems/combat.ts`（updateWorld 生长计时）、`src/entities/unit.ts`+`src/sim/{world,unit}.ts`（结算/阶段门双轨）、`src/systems/commands.ts`+`src/ui/tooltip.ts`（阶段拒砍+文案）、`src/types.ts`（TreeEnt 扩展）
- Affected tests: `scripts/sim-run.mjs`（世界生成基线）、`scripts/e2e-blackbox.mjs`（G4/G16/G21 适配 + G23 新增）、README/DESIGN 文档行
