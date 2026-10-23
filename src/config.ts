/**
 * Wilderlands · 全局数值与色板配置
 * 所有可调参数集中在此，改数值不改逻辑。
 */

export const CFG = {
  // 交易
  seedPrice: 2,
  // 主线目标（S4 荒诞修船）：倒扣在荒野的破船，没人见过海
  shipPos: { x: 36, z: 36 }, // 船的世界坐标（野外区）
  shipWoodNeed: 30, // 修船总需求
  shipStoneNeed: 20,
  shipDonateWood: 10, // 每次投入量
  shipDonateStone: 5,
  shipNearDist: 8, // 距船多远才能投入材料
  // 采集产出
  cropPerHarvest: 2,
  woodPerTree: 3,
  stonePerVein: 2,
  // 建造
  fenceCost: 2,
  houseCostWood: 10,
  houseCostStone: 5,
  // 农田（成熟秒数：家园快 / 野外慢）
  growHome: 15,
  growWild: 35,
  // 野狼
  wolfHp: 30,
  wolfDmg: 3,
  wolfSpeed: 3.2,
  wolfSpawn: 26,
  wolfMax: 6,
  // 拓荒者
  playerSpeed: 2.6,
  atkDmg: 5,
  atkRange: 1.7,
  atkCd: 0.8,
  hungerRate: 0.05,     // 100 → 0 约 33 分钟（长局友好，与 GDD 一致）
  eatHeal: 50,
  downRecover: 30,
  // 角色 AI（spec 011）
  idleScanRadius: 10,       // 闲时找活范围（米，以领队为中心）
  idleScanInterval: 2,      // 闲时扫描间隔（秒）
  wolfAutoEngageDist: 8,    // 狼多近时触发性格反应
  moodFearSpeedMul: 0.8,    // 害怕时移动速度
  moodIrritableWorkMul: 0.9,// 烦躁时工作速度
  moodExhaustedSpeedMul: 0.9,// 疲惫时移动速度
  moodFearRadius: 15,       // 离商摊多远算"独自一人"触发恐惧
  moodDowncastDur: 30,      // 低落持续秒数
  moodTalkChance: 0.15,     // 话痨每秒吐槽概率
  // 昼夜循环
  daySeconds: 240,      // 一昼夜时长（秒），约 2 分钟白昼 + 2 分钟夜晚
  // 浆果丛（野外食物）
  berryFood: 2,
  berryRespawn: 30,
  berryCount: 14,
  // 流浪者招募
  recruitCost: 25,
  wandererRespawn: 60,
  // 木矛（游商武器）
  spearPrice: 8,
  spearAtk: 3,
  // 背包
  inventoryCap: 40,     // 每人负重上限（单位 = Σ数量×weight）
  overloadRatio: 0.8,   // 超载阈值（负重占比 ≥ 此值减速）
  overloadSlow: 0.8,    // 超载移动减速系数
  // 商人收购（S3 动态价格）：基准价 + 每卖出 dropPer 个降 1 金 + 保底 min
  // 天亮时当日成交量按 tradeRecover 衰减（隔日回升）
  tradeBuy: {
    wood: { base: 2, dropPer: 4, min: 1 },
    stone: { base: 2, dropPer: 4, min: 1 },
    food: { base: 3, dropPer: 3, min: 1 },
  },
  tradeRecover: 0.3, // 隔日回升：成交量 ×0.3
  // 存档
  saveAutoInterval: 60, // 自动存档间隔（秒）
  // 技能（v0.4）：经验阈值表（三技能共用），Lv0..Lv5 封顶
  skillXPForLevel: [3, 8, 15, 25, 40],
  // 每级加成：采集 +负重上限 / 战斗 +攻击(封顶) / 种田 +收获(封顶)
  skillCapacityPerLv: 4,
  skillAtkPerLv: 1,
  skillAtkCap: 4,
  skillHarvestPerLv: 1,
  skillHarvestCap: 2,
  // 属性（spec 010 用就长）：等级表复用 skillXPForLevel，Lv0..Lv5
  attrStaminaPerLv: 10,    // 体力上限 +10/级（基础 100，封顶 150）
  attrVitalityPerLv: 5,    // 生命力上限 +5/级（基础 100，封顶 150）
  attrAtkPerLv: 1,         // 攻击 +1/级（叠加：5 + atkLv + 战斗技能 + 木矛3）
  attrDefPerLv: 1,         // 防御减伤 +1/级（狼伤 3 → max(1, 3-defLv)）
  staminaBase: 100,
  staminaLowPct: 0.2,      // 体力 ≤20% → 移动/采集 ×0.8
  staminaMoveCost: 0.5,    // 跑动消耗 /秒
  staminaRest: 1,          // 静止恢复 /秒
  staminaEat: 30,          // 进食额外 +30 体力
  staminaWorkCost: 3,      // 采集一次（树/石/浆果）
  staminaFarmCost: 2,      // 种地一次
  staminaAtkCost: 2,       // 攻击一次
  hungerPenaltyAt: 20,     // 饥饿 ≤20 → 攻击 -1、采集 ×0.9
  hungerAtkPenalty: 1,
  hungerWorkSlow: 0.9,
} as const;

/** 物品元数据：label 用于 UI，weight 用于负重计算，desc 为荒诞描述（背包悬浮详情） */
export const ITEMS = {
  wood: { label: '木材', weight: 2, desc: '荒野唯一的硬通货——树倒了，价没倒。' },
  stone: { label: '石头', weight: 2, desc: '商人说这石头会唱歌，但没人真听到过。' },
  food: { label: '食物', weight: 1, desc: '吃下去能撑一阵。别问是什么做的。' },
  seed: { label: '种子', weight: 1, desc: '种下去是希望；种歪了，就长成浆果。' },
  berry: { label: '浆果', weight: 1, desc: '吃了可能看见幻觉——狼在跳舞那种。' },
} as const;

export type ItemId = keyof typeof ITEMS;

/** 技能标签（HUD 显示） */
export const SKILL_LABELS = {
  gather: '采集',
  combat: '战斗',
  farm: '种田',
} as const;

export type SkillId = keyof typeof SKILL_LABELS;

export const WORLD = {
  tileSize: 2,
  grid: 48,          // 地块数（边长）
  homeRadius: 10,    // 家园区半径（格）
  wildRadius: 16,    // 野地区半径（格）
  treeCount: 220,
  rockCount: 90,
  terrainAmp: 1.2,   // 地形起伏幅度（米）
  terrainFreq: 0.35, // 地形噪声频率
} as const;

export const ANIM = {
  walkSpeed: 6.0,     // 走路摆腿频率（弧度/秒）
  walkSwing: 0.25,   // 走路摆腿幅度（弧度）
  gatherSpeed: 5.0,  // 采集挥砍频率
  gatherSwing: 1.2,  // 采集挥砍幅度（弧度，举过头顶）
  bobHeight: 0.02,   // 走路身体上下起伏高度
  blendSpeed: 8.0,   // 站立↔走路姿态过渡速度（越大切换越干脆）
  kneeBend: 0.55,    // 小腿相对大腿的弯曲系数（膝盖弯曲）
  elbowBend: 0.35,   // 小臂相对上臂的弯曲系数（肘部自然弯曲）
} as const;

/** 小队公共金币（不占负重） */
export const START_GOLD = 20;

/** 每名拓荒者初始背包（招募的第 4 人空背包） */
export const START_INV: Record<ItemId, number> = { wood: 3, stone: 2, food: 3, seed: 1, berry: 0 };

export const PALETTE = {
  background: 0xaab88e,
  fog: 0xaab88e,
  tileHome: 0x5a7a48,
  tileWild: 0x8a7a50,
  tileMine: 0x6a6a72,
  tilePlanted: 0x5a4632,
  tileGrowing: 0x7a9a4a,
  tileMature: 0xd0a840,
  ear: 0xffd94a,
  treeCrown: 0x2f6b2f,
  treeTrunk: 0x5a3a22,
  rock: 0x7a7a88,
  fence: 0xb08a50,
  houseWall: 0x9a7a44,
  houseRoof: 0x8a3a2a,
  merchantStall: 0x5a4632,
  merchantCanopy: 0x7a4a8a,
  merchantSign: 0xd0a840,
  goldBall: 0xe0b850,
  gridLine: 0x24301c,
  gridCenter: 0x3a4a2a,
  unitColors: [0xcc5a3a, 0x3a7acc, 0x8a5acc, 0x2f9a6a] as const,
  unitSkin: 0xd8b088,
  unitDark: 0x2a2a28,
  toolHandle: 0x8a6a3a,
  toolHead: 0xd0d0d8,
  wolfFur: 0x6a4638,
  wolfEye: 0xff3322,
  berryLeaf: 0x3a7a3a,
  berryRed: 0xd04040,
  wandererCloak: 0x8a7a52,
  spearTip: 0xb8b8c0,
  selectBlue: 0x4d9de0,
  markerGold: 0xffd54a,
  shadowPad: 0x151a12,
  shipHull: 0x8a5a2a,
  shipKeel: 0x5a3a1a,
  shipMast: 0x6a4a2a,
  shipSail: 0xc8b090,
  shipSailOld: 0x8a7a5a,
  captainHat: 0x2a4a8a,
  captainScarf: 0xd04040,
} as const;

export const UNIT_NAMES = ['拓荒者·罗恩', '拓荒者·克莉', '拓荒者·巴德'];
export const WANDERER_NAMES = ['流浪者·艾达', '流浪者·凯恩', '流浪者·梅尔'];
