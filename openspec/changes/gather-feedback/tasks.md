# Tasks

> 现状（propose 时点）：工作区已有未提交 WIP——F2 飘字钩五处 / floaters.ts / gainFx 缓冲 / CSS / F1 状态条 / main.ts 接线已完成；`tickDeathAnims` 尚未实现导致 tsc 暂红。apply 从 1.1 起按序补完并验证。

## 1. 消亡动画（F3）

- [x] 1.1 `core/world.ts`：`dyingTrees/dyingRocks` 补间表（decompose 原矩阵 → 0.4s scale→0 + y 下沉 0.3），`applyTreeVisible/applyRockVisible(false)` 进入补间、`(true)` 清除并恢复原矩阵
- [x] 1.2 导出 `tickDeathAnims(dt)` 并在 `main.stepGame` 接线（WIP 已引用，实现本项后 tsc 恢复）
- [x] 1.3 右键命令对 `alive === false` 资源拒绝下达（核实 commands.ts 现状，缺则补）

## 2. 飘字与状态条收尾（F2/F1）

- [x] 2.1 核实 WIP：五处进包钩子（树/石/浆果/收获/杀狼）文本与配色、背包满分支无钩子、`initFloaters` 在 boot 调用
- [x] 2.2 `npx tsc --noEmit` + `npm run build` 通过

## 3. 验收（spec 012 三条 Requirement）

- [x] 3.1 sim-run 豁免记录：纯表现层不改结算，直接跑 `node scripts/sim-run.mjs` 确认 163/163 零波动（哨兵）
- [x] 3.2 黑盒新增 `G21 收获反馈`：砍树飘字含 `木材`、curAction 含 `▓` 状态条、树倒地后计数-1 轮询；注册进 GROUPS
- [x] 3.3 相关组回归：`WL_ONLY=G4,G16,G20,G21` 黑盒全绿（树冠放大后 G20 ③ 已改 gatherAction 助手点资源本体，WIP 待应用）
- [x] 3.4 README 调试钩子/黑盒组数（20→21）与 DESIGN 表现层一行同步

## 4. 提交

- [x] 4.1 数值调整独立提交（SCENE 几何 + 昼夜 600s/nightStartRatio 参数化 + sim-run 自适应断言——本批未提交，与功能分开）
- [ ] 4.2 gather-feedback 实现提交 + 文档提交
