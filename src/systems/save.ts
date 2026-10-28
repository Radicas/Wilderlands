/**
 * Wilderlands · 存档系统
 * 序列化/反序列化/版本迁移/槽位读写/JSON 导出导入。
 * 读档采用「写 pending → location.reload() → 启动时 applySave」流程（宪法 I 纯前端零后端）。
 */
import * as THREE from 'three';
import { isMuted, setBed, setMuted } from '../core/sound';
import { CFG } from '../config';
import type { SaveData } from '../types';
import {
  buildings,
  gold,
  logMsg,
  players,
  setGold,
  setSavePending,
  tiles,
  timeOfDay,
  wanderer,
} from '../state';
import { ship } from './ship';
import { tileAt, tileMats } from '../core/world';
import { placeFenceAt, placeHouseAt } from './build';
import { PioneerUnit } from '../entities/unit';
import { migrateSave, SAVE_VERSION } from './migrate';
import { capacityBonus } from './skills';

const KEY = (slot: string): string => 'wilderlands.save.' + slot;

// ---- 收集 / 恢复 ----

export function collectSave(): SaveData {
  return {
    version: SAVE_VERSION,
    muted: isMuted(),
    savedAt: new Date().toISOString(),
    gold,
    time: timeOfDay.t,
    units: players.map((u) => ({
      name: u.name,
      x: u.pos.x,
      z: u.pos.z,
      hp: u.hp,
      hunger: u.hunger,
      hasSpear: u.hasSpear,
      atkDmg: u.atkDmg,
      inv: { ...u.inv },
      skills: { ...u.skills },
      attrs: { ...u.attrs },
      personality: u.personality,
      mood: u.mood,
    })),
    buildings: buildings.map((b) => ({
      type: b.type,
      x: b.mesh.position.x,
      z: b.mesh.position.z,
    })),
    tiles: tiles.map((t) => ({ x: t.x, z: t.z, state: t.state, grow: t.grow })),
    wanderer: wanderer
      ? { available: wanderer.available, respawn: wanderer.respawn }
      : null,
    ship: { wood: ship.wood, stone: ship.stone, done: ship.done },
  };
}

/** 启动时按存档初始化（世界/树/石/浆果已重新生成，这里只恢复玩家侧状态） */
export function applySave(save: SaveData): void {
  setMuted(save.muted ?? false);
  setGold(save.gold);
  timeOfDay.t = save.time;
  setBed(timeOfDay.t >= CFG.nightStartRatio);

  // 建筑（纯放置，不扣资源）
  for (const b of save.buildings) {
    const p = new THREE.Vector3(b.x, 0, b.z);
    if (b.type === 'fence') placeFenceAt(p);
    else placeHouseAt(p);
  }

  // 农田生长状态
  for (const ts of save.tiles) {
    const tile = tileAt(ts.x, ts.z);
    if (!tile) continue;
    tile.state = ts.state;
    tile.grow = ts.grow;
    tile.mesh.visible = ts.state !== 0;
    tile.mesh.material = tileMats[ts.state] ?? tileMats[0];
    tile.ear.visible = ts.state === 3;
  }

  // 队员（位置/血量/饥饿/背包/技能/木矛）
  for (const us of save.units) {
    const u = new PioneerUnit('player', us.x, us.z, us.name);
    u.hp = us.hp;
    u.hunger = us.hunger;
    u.inv = { ...us.inv };
    u.skills = { ...us.skills };
    // 属性恢复（spec 010）：体力当前值 + 经验；生命力/攻击上限按经验重算
    u.attrs = { ...(us.attrs ?? { stamina: CFG.staminaBase, staminaXp: 0, vitalityXp: 0, atkXp: 0, defXp: 0 }) };
    u.maxHp = 100 + Math.min(5, Math.floor((u.attrs.vitalityXp >= 3 ? 1 : 0) + (u.attrs.vitalityXp >= 8 ? 1 : 0) + (u.attrs.vitalityXp >= 15 ? 1 : 0) + (u.attrs.vitalityXp >= 25 ? 1 : 0) + (u.attrs.vitalityXp >= 40 ? 1 : 0))) * CFG.attrVitalityPerLv + 100 - 100;
    u.hp = Math.min(u.hp, u.maxHp);
    u.atkDmg = CFG.atkDmg + Math.min(5, Math.floor((u.attrs.atkXp >= 3 ? 1 : 0) + (u.attrs.atkXp >= 8 ? 1 : 0) + (u.attrs.atkXp >= 15 ? 1 : 0) + (u.attrs.atkXp >= 25 ? 1 : 0) + (u.attrs.atkXp >= 40 ? 1 : 0))) * CFG.attrAtkPerLv;
    // 负重上限按技能加成重算（构造时用默认 0 技能）
    u.capacity = CFG.inventoryCap + capacityBonus(u);
    // 性格与情绪恢复（spec 011）
    if (us.personality) u.personality = us.personality;
    if (us.mood) u.mood = us.mood;
    if (us.hasSpear) {
      u.hasSpear = true;
      u.equipSpear();
    } else {
      u.atkDmg = us.atkDmg;
    }
  }

  // 流浪者
  if (save.wanderer && wanderer) {
    wanderer.available = save.wanderer.available;
    wanderer.respawn = save.wanderer.respawn;
    wanderer.mesh.visible = save.wanderer.available;
  }

  // 主线修船进度（船体视觉由 entities/ship 按状态恢复）
  ship.wood = save.ship?.wood ?? 0;
  ship.stone = save.ship?.stone ?? 0;
  ship.done = save.ship?.done ?? false;
}

// ---- 槽位读写 ----

export function saveToSlot(slot: string): boolean {
  try {
    localStorage.setItem(KEY(slot), JSON.stringify(collectSave()));
    return true;
  } catch {
    return false;
  }
}

export function readSlot(slot: string): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY(slot));
    if (!raw) return null;
    return migrateSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 槽位存档时间戳（无存档返回 null） */
export function slotStamp(slot: string): string | null {
  try {
    const raw = localStorage.getItem(KEY(slot));
    if (!raw) return null;
    const s = JSON.parse(raw) as { savedAt?: string };
    return typeof s.savedAt === 'string' ? s.savedAt : null;
  } catch {
    return null;
  }
}

/** 请求读档：写 pending 标记 → 页面重载 → 启动时 applySave */
export function saveRequest(slot: string): void {
  if (!saveToSlot(slot)) {
    logMsg('存档失败（浏览器存储不可用）');
    return;
  }
  setSavePending(slot);
  location.reload();
}

/** 纯读档：只标记待读槽位并重载，不覆盖槽位内容 */
export function loadRequest(slot: string): void {
  setSavePending(slot);
  location.reload();
}

// ---- 导出 / 导入 ----

export function exportSave(): void {
  const blob = new Blob([JSON.stringify(collectSave(), null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wilderlands-save-' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  logMsg('存档已导出为 JSON 文件');
}

export function importSave(file: File, onDone: (ok: boolean, msg: string) => void): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = migrateSave(JSON.parse(String(reader.result)));
      if (!data) {
        onDone(false, '存档文件版本不兼容或格式错误');
        return;
      }
      // 写入自动槽并标记待读，刷新后按该存档初始化
      localStorage.setItem(KEY('auto'), JSON.stringify(data));
      setSavePending('auto');
      onDone(true, '导入成功，即将读档…');
    } catch {
      onDone(false, '无法解析该文件（不是合法的存档 JSON）');
    }
  };
  reader.onerror = () => onDone(false, '读取文件失败');
  reader.readAsText(file);
}

/** 自动存档（静默，60 秒一次，写入自动槽） */
export function initAutoSave(): void {
  setInterval(() => {
    saveToSlot('auto');
  }, CFG.saveAutoInterval * 1000);
}
