# Design

## 决策一览

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| D1 | 树种定义 | `config.TREES` 表：`{name, wood, workDur, toMature, scale:{sprout,young}}` × 3（松/橡/桦） | 数值单一来源惯例（CFG/SCENE/ANIM 同款）；松 = 现值原样（3 木/2.2s/45s），所有旧测试的回归锚 |
| D2 | 几何与批次 | 每树种一套干/冠几何 × InstancedMesh 对（共 6 IM），**不做 instanceColor 抖色** | 用户要"几种树"= 形状可辨：松=现有锥冠；橡=双球冠（两个 Sphere 并入一个 BufferGeometry）+粗短干；桦=细高白干+小球冠。draw call 2→6 依旧 O(1) |
| D3 | 树种映射 | `i % 4 → [松,松,橡,桦]`（确定性序号，非随机流） | 50/25/25 精确占比 + **不消耗 Rng**，两轨同一行代码规则，sim 流序零额外扰动 |
| D4 | 密度 | `treeCount 220→150`；接受点间平面距离 <3.2m 重采样（上限 6 次尝试，失败则弃点） | 用户要"稍微稀疏"；重采样会让 sim 下游 Rng 流（岩脉/狼位）位移——属世界生成参数变更，163 哨兵基线同刀搬迁（昼夜参数化的先例同款处理） |
| D5 | 生长阶段 | 四态机 `stump(空窗15s) → sprout → young → mature`；`toMature` 为砍倒→成材**总**时长（松 45 与旧重生等长）；阶段均分剩余（stump 15 固定） | 阶段少而可见差大（0.22/0.55/1.0 三级缩放）；空窗期用已有消亡下沉动画收尾，不做树桩模型（省一组几何，观感=被拖走） |
| D6 | 换阶写矩阵 | build 时每棵树预计算 sprout/young/mature **三套实例矩阵**存进 `treeOriginals`；换阶 = 拷贝预存矩阵（O(1)，无每帧 decompose/scale 运算） | 与 tickDeathAnims 既有写路径同构；死亡补间从**当前阶段矩阵**起步（树桩期被砍的小树也正确下沉） |
| D7 | alive 语义 | `alive = phase !== 'stump'`；`respawn` 字段改为 stump 空窗倒计时（单位语义迁移，两轨同步） | targets getter / G21② 计数按 alive 过滤——初长成树全部 mature，旧断言零干扰 |
| D8 | 免砍门 | 命令侧：右键非 mature → `logMsg('「白桦·幼苗」还太小，再等等…')` 不建任务；自治侧：findIdleWork 过滤 mature | 表现门+规则门都要（否则 lazy/勤快角色贴脸等树苗长大，浪费工时） |
| D9 | 结算读取 | commands.ts 建任务时从 `TREES[species]` 读 `workDur`；unit._finishGather / sim 结算读 `wood` | 现状 2.2 硬编码点在 commands.ts:210 与 unit.ts:768（woodPerTree），两处都收敛到表 |
| D10 | 存档 | **不 bump SAVE_VERSION**（树不落盘，两轨现状即世界重建） | proposal 已声明；migrate-check 无涉及 |

## 实例索引映射（D2 的实现要点）

现状：`instanceId ≡ trees[] 下标`（单 IM 对）。分树种后每 IM 有独立 instanceId 空间：

- `trees[gi] = { p, species, slot, phase, phaseT, mats:{sprout,young,mature}, mesh }`——`slot` 为该树种内序号
- 每树种闭包：`crownIM_s.userData.resolveInstance = (id) => ({kind:'tree', ent: trees[speciesBase[s]+id]})`（`speciesBase` 为全局序号偏移表，build 完即冻结）
- `applyTreeVisible/树消亡 tick/setInstanceUnder` 现按 (im, id) 操作——改为按 `tree.species` 定位 IM 对 + slot 写矩阵；`treeOriginals` 并入 TreeEnt.mats（全局一套引用）
- `bindVisible(anchor, gi, fn)` 注册表按全局 gi——不变

## 生长计时（updateWorld 改造，combat.ts 尾函数 + sim 镜像）

```
tree.phase !== 'mature':
  tree.phaseT -= dt
  if (phaseT <= 0): 进下一阶（mats 换拷贝写回 IM）; phaseT = 阶段时长
tree.phase === 'stump' && phaseT <= 0 → sprout（上面即含）
```
`w.isNight` 等既有字段零触碰。前端 Math.random 无流序问题；sim 用同一循环。

## 断言与夹具

- `main.ts targets.trees` 增补 `{species, phase}` 字段（只读展示层，G23 与 tooltip 文案共用）
- **G23 森林生态**（串行组，turbo 常规）：①树数 ∈[130,150] 且三种 species 齐 + 最小间距≥3.2（页内几何扫描）；②砍倒松树 → 该坐标 15s 内 phase=sprout 且幼苗 scale 小（用 treeInfo/矩阵采样或阶段字段）→ 45s mature 可再砍；③右键幼苗被拒 + 无飘字 + 背包不变；④橡树 +4 桦树 +2 结算
- G21② 计数口径、sim-run 采集/树数相关断言按新基线搬迁
- 三值最小探针（apply 前置）：a) 双球冠合并 BufferGeometry 后 raycast instanceId 反查仍准（合并几何对拾取透明——需实测）；b) 150 棵树 reject 采样循环在 headless 生成耗时无感（<50ms）；c) 换阶矩阵拷贝与 tickDeathAnims 并发（砍刚换阶的小树）不互踩

## 风险

| 风险 | 缓解 |
|------|------|
| reject 采样改变 sim Rng 流 → 163 哨兵大面积位移 | 预期内基线搬迁；断言多为结构性（"存在可采树""砍后+3"），物种/树数口径点单独修 |
| 幼树门让旧测试"砍最近树"撞上幼苗等待 | 新世界全部 mature 开局；同刀内只有 G23 主动砍树，其余组用现势树（成材期后才有幼苗） |
| 自治角色围着一片幼苗不干活 | findIdleWork 过滤 mature ✓（D8）；lazy 本就发呆 |
| 观感倒退：树变少显得荒 | 间距 3.2m + 保留环形带密度梯度；SCENE 尺寸不动（个体仍是 2.7 倍人高） |
