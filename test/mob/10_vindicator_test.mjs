import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget, tick } from "../harness/sim.mjs";
import { VindicatorData } from "../../src/game/presets/monster/zombie/vindicator.ts";

/**
 * 描述（Vindicator）：
 *   卫道士手持战斧，360 血、32 攻击、200ms 间隔；
 *   攻击时战斧挥动，停止攻击后恢复。
 *
 * 验收路径：
 *   1) 检查数值与 axe 武器。
 *   2) tryStartAttack 后检查 weaponSwinging。
 *   3) 让 100 血植物承受 4 次 32 伤害。
 *   4) stopAttacking 后检查挥动结束。
 *
 * 预期结果：
 *   100 血植物 800ms 内死亡；攻击中 weaponSwinging=true，
 *   停止后为 false。
 *
 * 为什么：
 *   VindicatorData.attackDamage=32、attackInterval=200；
 *   withWeaponModel 在 onAttackStarted/Stopped 中切换 weaponSwinging。
 */

test("卫道士基础数值与战斧", () => {
  resetSim();
  const { model } = spawnMob(VindicatorData, { col: 8, row: 2 });

  assert.equal(model.mid, 10);
  assert.equal(model.health, 360);
  assert.equal(model.attackDamage, 32);
  assert.equal(model.attackInterval, 200);
  assert.equal(model.weaponKey, "attach/hd_axe");
});

test("战斧攻击 4 次击杀 100 血植物", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(VindicatorData, { col: 8, row: 2 });
  const target = makePlantTarget({ col: 7, row: 2, hp: 100 });

  model.tryStartAttack(entity, target);
  assert.equal(model.weaponSwinging, true);

  tick(sim, 800);
  assert.equal(target.model.health, 0);
  assert.equal(model.weaponSwinging, false);
});

test("手动停止攻击结束挥动", () => {
  resetSim();
  const { model, entity } = spawnMob(VindicatorData, { col: 8, row: 2 });
  const target = makePlantTarget({ col: 7, row: 2 });
  model.tryStartAttack(entity, target);

  model.stopAttacking(entity);
  assert.equal(model.weaponSwinging, false);
  assert.equal(model.attackingId, null);
});
