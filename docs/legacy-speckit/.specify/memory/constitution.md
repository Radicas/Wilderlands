# Wilderlands 项目宪法

本文件是 Wilderlands（荒野开拓者）项目的最高治理准则。所有 spec、plan、tasks 在评审时都必须对照本宪法。违反 MUST 级条款的设计，必须改 spec/plan，而不是稀释宪法。

## 核心原则

### I. 纯前端零后端（NON-NEGOTIABLE）

Wilderlands 是一个浏览器内运行的单页沙盒游戏原型。

- **不引入任何后端服务、数据库或网络请求**。所有状态在内存中，`localStorage` 仅用于可选的本地存档。
- **构建产物必须能静态托管**。`vite build` 输出的 `dist/` 放到任意静态服务器（甚至 file://）都能跑。
- **不引入 Node 运行时依赖**。`dependencies` 只放浏览器端能跑的包；构建工具链（vite、typescript、@types）放 `devDependencies`。

### II. 单一数值数据源

所有游戏数值（价格、产量、生长时间、战斗伤害、刷新间隔等）必须集中在 `src/config.ts`，以 `as const` 导出。

- **禁止在业务代码里硬编码魔法数字**。新数值先加进 config，再被引用。
- 经济闭环（种子→食物→金币）的平衡性调整只改 config，不改系统逻辑。
- 颜色、命名、实体元数据同理，统一在 config 里管理。

### III. 模块化分层架构

代码按职责分层，新功能必须落到对应目录，不允许跨层乱穿。

```
src/
  config.ts / types.ts / state.ts / main.ts   # 顶层：配置、类型、全局状态、入口
  core/      renderer · world · input           # 基础设施：渲染、世界生成、输入
  entities/  unit.ts                         # 实体类
  systems/   farm · build · combat · economy · commands  # 玩法系统
  ui/        hud · tooltip · trade            # 界面层
```

- **systems 只处理玩法逻辑，不直接碰 Three.js 渲染细节**；渲染走 core/renderer。
- **ui 只做展示和事件转发，不直接改世界状态**；命令经由 systems/commands 分发。
- 新增系统放进 `src/systems/`，新增实体放进 `src/entities/`，不允许在 main.ts 里堆业务逻辑。

### IV. TypeScript 严格模式

- `tsc --noEmit` 必须 0 错误。
- 新代码用现代类型语法（`string | null`、`Record<K, V>`），不用 `any`；确实要用 `any` 的地方必须加注释说明原因。
- 领域类型定义在 `types.ts`，不在各文件里散落重复声明。

### V. 性能与渲染纪律

- 场景对象复用，不每帧 new 临时 Vector3/Object3D。
- 草地、树木这类重复实体用 InstancedMesh 或 Group 复用，不用一个一个独立 Mesh。
- 主循环固定时间步长更新逻辑，渲染帧率自适应；不阻塞主线程做重计算。

## 工作流约束

### 默认走 Spec Kit 流程

主人每次下达开发任务时，助手必须按以下规则判断走哪条路：

**大改动（必须走完整 Spec Kit）**——满足任一条件：
- 新增一个玩法系统（如角色 AI、建造、种田重做）
- 改动涉及 3 个以上源文件，或新增目录/新模块
- 修改宪法里的 MUST 条款
- 主人明确说"写个 spec"或"按 spec 来"

大改动流程：
1. `specs/NNN-feature-name/spec.md` —— 写清楚做什么、不做什么、玩家看到什么
2. `specs/NNN-feature-name/plan.md` —— 技术方案、改哪些文件、数据结构怎么动
3. `specs/NNN-feature-name/tasks.md` —— 拆成可执行的小步，每步可验证
4. 助手按 tasks 逐步实现，每步跑 `tsc --noEmit` + `npm run build` + `node scripts/smoke.mjs`
5. 全部完成后截图验证视觉

**小改动（直接做）**——同时满足：
- 改的是已有系统内的逻辑/数值/UI 文案/bug 修复
- 改动 ≤ 2 个源文件
- 不新增系统、不改数据结构、不动宪法

小改动也要跑：`tsc --noEmit` → `npm run build` → `node scripts/smoke.mjs`，有视觉变化就截图。

**判断不了的时候，按大改动走。**

### 其他约束
- 每个 spec 目录（`specs/NNN-feature-name/`）下至少有 `spec.md`、`plan.md`、`tasks.md` 三份文件。
- **经济闭环可复算**。改动数值后必须能口算：1 个种子多少钱、收几个食物、卖多少钱、净利润多少。

## 治理

- 本宪法随项目演进修订，修订需更新版本号。
- `/speckit.analyze` 发现与 MUST 条款冲突时，按 CRITICAL 处理。

**Version**: 1.0.0 | **Ratified**: 2026-10-22
