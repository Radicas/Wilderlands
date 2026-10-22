/**
 * Wilderlands · 悬停提示
 * 鼠标指到实体时显示"这是什么、能干嘛"。
 */
import { interMeshes, selectableMeshes } from '../state';
import { camera } from '../core/renderer';
import { raycaster, toNDC, rayGround } from '../systems/commands';
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
    if (hits.length) {
      const ent = hits[0].object.userData.ent as {
        kind: string;
        ent?: { alive?: boolean; dead?: boolean };
      };
      if (ent.kind === 'tree') txt = ent.ent?.alive ? '松树 · 右键砍伐得木材' : '树桩 · 待重生';
      else if (ent.kind === 'rock') txt = ent.ent?.alive ? '岩石 · 右键开采得石头' : '矿脉 · 待重生';
      else if (ent.kind === 'wolf') txt = ent.ent?.dead ? '' : '野狼 · 危险！右键攻击';
      else if (ent.kind === 'merchant') txt = '贸易站 · 出售食物 / 购买种子';
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
