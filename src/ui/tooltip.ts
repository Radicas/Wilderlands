/**
 * Wilderlands · 悬停提示
 * 鼠标指到实体时显示"这是什么、能干嘛"。
 */
import { CFG, TREES } from '../config';
import { interMeshes, selectableMeshes } from '../state';
import { camera } from '../core/renderer';
import { raycaster, toNDC, rayGround, pickBest } from '../systems/commands';
import { tileAt } from '../core/world';

const tip = document.createElement('div');
tip.id = 'tip';
document.body.appendChild(tip);

export function updateHover(x: number, y: number): void {
  const ndc = toNDC(x, y);
  raycaster.setFromCamera(ndc, camera);

  let txt = '';

  // 角色
  const hitP = raycaster.intersectObjects(selectableMeshes, false);
  if (hitP.length) {
    const u = hitP[0].object.userData.unit;
    if (u && !u.down) {
      txt = u.name + (u.selected ? ' · 已选中' : ' · 左键选中');
    }
  }

  if (!txt) {
    const hits = raycaster.intersectObjects(interMeshes, false);
    const ent = pickBest(hits);
    if (ent) {
      if (ent.kind === 'tree') {
        const tr = ent.ent;
        txt = tr
          ? !tr.alive
            ? '树桩 · 不久会再冒新芽'
            : tr.phase === 'mature'
              ? TREES[tr.species].name + ' · 右键砍伐得木材'
              : TREES[tr.species].name + '·' + (tr.phase === 'sprout' ? '幼苗' : '小树') + ' · 还太小'
          : '';
      }
      else if (ent.kind === 'rock') txt = ent.ent?.alive ? '岩石 · 右键开采得石头' : '矿脉 · 待重生';
      else if (ent.kind === 'berry') txt = ent.ent?.alive ? '浆果丛 · 右键采集得食物' : '浆果丛 · 采空了';
      else if (ent.kind === 'wolf') txt = ent.ent?.dead ? '' : '野狼 · 危险！右键攻击';
      else if (ent.kind === 'wanderer')
        txt = ent.ent?.available
          ? '流浪者 · 右键招募（需 ' + CFG.recruitNeedHouse + ' 座木屋 · 全队口粮 ' + CFG.recruitNeedFood + ' · ' + CFG.recruitCost + ' 金）'
          : '流浪者 · 已加入（等新人来）';
      else if (ent.kind === 'merchant') txt = '贸易站 · 出售食物 / 购买种子与木矛';
      else if (ent.kind === 'ship') txt = '搁浅的破船 · 主线目标（右键修船）';
      else if (ent.kind === 'captain') txt = '船长 · 一头穿水手服的野狼（右键聊聊）';
      else if (ent.kind === 'fence') txt = '围栏 · 据点边界';
      else if (ent.kind === 'house') txt = '木屋 · 附近休息回血';
    } else {
      const g = rayGround();
      const tile = g && tileAt(g.x, g.z);
      if (tile && tile.state === 3) txt = '成熟农田 · 右键收获食物';
      else if (tile && tile.state === 1) txt = '耕地 · 等待生长';
      else if (tile && tile.state === 2) txt = '农田 · 生长中';
    }
  }

  if (txt) {
    tip.textContent = txt;
    tip.style.display = 'block';
    tip.style.left = x + 14 + 'px';
    tip.style.top = y + 14 + 'px';
  } else {
    tip.style.display = 'none';
  }
}
