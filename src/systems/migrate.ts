/**
 * Wilderlands · 存档版本迁移（纯函数）
 * 无 DOM / three 依赖，可被 node 直接编译测试（scripts/regress.sh 自动回归）。
 * 当前版本：v5（spec 011 角色 AI：性格+情绪）。历史 v1/v2/v3/v4 在此逐级升级。
 */
import type { Personality, SaveData } from '../types';
import { rollPersonality } from './personality';

export const SAVE_VERSION = 5;

const DEFAULT_SKILLS = { gather: 0, combat: 0, farm: 0 };
const DEFAULT_SHIP = { wood: 0, stone: 0, done: false };
const DEFAULT_ATTRS = { stamina: 100, staminaXp: 0, vitalityXp: 0, atkXp: 0, defXp: 0 };

function randomPersonality(): Personality {
  return rollPersonality(Math.random(), Math.random(), Math.random());
}

export function migrateSave(raw: unknown): SaveData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version === SAVE_VERSION) return raw as SaveData;
  if (r.version === 4) return migrateV4ToV5(raw);
  if (r.version === 3) {
    const v4 = migrateV3ToV4(raw);
    return v4 ? migrateV4ToV5(v4 as unknown) : null;
  }
  if (r.version === 2) {
    const v3 = migrateV2ToV3(raw);
    const v4 = v3 ? migrateV3ToV4(v3 as unknown) : null;
    return v4 ? migrateV4ToV5(v4 as unknown) : null;
  }
  if (r.version === 1) {
    const v2 = migrateV1ToV2(raw);
    if (!v2) return null;
    const v3 = migrateV2ToV3(v2 as unknown);
    const v4 = v3 ? migrateV3ToV4(v3 as unknown) : null;
    return v4 ? migrateV4ToV5(v4 as unknown) : null;
  }
  return null;
}

/** v4 → v5：队员补性格与情绪（旧档没有 spec 011 角色 AI） */
function migrateV4ToV5(raw: unknown): SaveData | null {
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.units)) return null;
  const units = r.units.map((u) => {
    const unit = (u ?? {}) as Record<string, unknown>;
    return {
      ...unit,
      personality: unit.personality ?? randomPersonality(),
      mood: unit.mood ?? 'neutral',
    };
  });
  return { ...r, version: SAVE_VERSION, units } as unknown as SaveData;
}

/** v3 → v4：队员补属性默认值（旧档没有 spec 010 五维属性） */
function migrateV3ToV4(raw: unknown): SaveData | null {
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.units)) return null;
  const units = r.units.map((u) => {
    const unit = (u ?? {}) as Record<string, unknown>;
    const attrs =
      unit.attrs && typeof unit.attrs === 'object' && !Array.isArray(unit.attrs)
        ? { ...DEFAULT_ATTRS, ...(unit.attrs as Record<string, unknown>) }
        : { ...DEFAULT_ATTRS };
    return { ...unit, attrs };
  });
  return { ...r, version: SAVE_VERSION, units } as unknown as SaveData;
}

/** v1 → v2：队员补 skills 默认值（旧档没有技能经验） */
function migrateV1ToV2(raw: unknown): SaveData | null {
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.units)) return null;
  const units = r.units.map((u) => {
    const unit = (u ?? {}) as Record<string, unknown>;
    const skills =
      unit.skills && typeof unit.skills === 'object' && !Array.isArray(unit.skills)
        ? { ...DEFAULT_SKILLS, ...(unit.skills as Partial<Skills>) }
        : { ...DEFAULT_SKILLS };
    return { ...unit, skills };
  });
  return { ...r, version: 2, units } as unknown as SaveData;
}

/** v2 → v3：补主线修船进度默认值（旧档没有船） */
function migrateV2ToV3(raw: unknown): SaveData | null {
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.units)) return null;
  const ship =
    r.ship && typeof r.ship === 'object' && !Array.isArray(r.ship)
      ? { ...DEFAULT_SHIP, ...(r.ship as Partial<typeof DEFAULT_SHIP>) }
      : { ...DEFAULT_SHIP };
  return { ...r, version: SAVE_VERSION, ship } as unknown as SaveData;
}
