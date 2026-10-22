/**
 * Wilderlands · 全局数值与色板配置
 * 所有可调参数集中在此，改数值不改逻辑。
 */

export const CFG = {
  // 交易
  seedPrice: 2,
  cropPrice: 3,
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
  hungerRate: 0.2,
  eatHeal: 50,
  downRecover: 30,
} as const;

export const WORLD = {
  tileSize: 2,
  grid: 16,          // 地块数（边长）
  homeRadius: 5.5,   // 家园区半径（格）
  wildRadius: 7.5,   // 野地区半径（格）
  treeCount: 46,
  rockCount: 22,
} as const;

export const START_BAG = { gold: 20, wood: 10, stone: 5, food: 10, seed: 5 };

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
  unitColors: [0xcc5a3a, 0x3a7acc, 0x8a5acc] as const,
  unitSkin: 0xd8b088,
  unitDark: 0x2a2a28,
  toolHandle: 0x8a6a3a,
  toolHead: 0xd0d0d8,
  wolfFur: 0x6a4638,
  wolfEye: 0xff3322,
  selectBlue: 0x4d9de0,
  markerGold: 0xffd54a,
  shadowPad: 0x151a12,
} as const;

export const UNIT_NAMES = ['拓荒者·罗恩', '拓荒者·克莉', '拓荒者·巴德'];
