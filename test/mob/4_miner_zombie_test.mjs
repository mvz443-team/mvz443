import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget, tick } from "../harness/sim.mjs";
import { MinerZombieData } from "../../src/game/presets/monster/zombie/miner_zombie.ts";

/**
 * 描述（MinerZombie）：
 *   矿工僵尸手持镐子，攻击力 60；攻击开始时武器进入挥动状态，停止攻击时恢复。
 *
 * 验收路径：
 *   1) onCreate 后检查 weaponKey / weaponVisible / weaponSwinging。
 *   2) tryStartAttack 后检查 weaponSwinging。
 *   3) 让 100 血植物承受两次 60 伤害。
 *   4) stopAttacking 后检查武器挥动状态。
 *
 * 预期结果：
 *   武器 key=attach/hd_pickaxe；攻击中 weaponSwinging=true；
 *   100 血植物 400ms 内死亡（60+40）；停止攻击后 weaponSwinging=false。
 *
 * 为什么：
 *   withWeaponModel.onAttackStarted 置 weaponSwinging=true；
 *   MinerZombieData.attackDamage=60、attackInterval=200。
 */

test("镐子武器初始可见且不挥动", () => {
  resetSim();
  const { model } = spawnMob(MinerZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 4);
  assert.equal(model.weaponKey, "attach/hd_pickaxe");
  assert.equal(model.weaponVisible, true);
  assert.equal(model.weaponSwinging, false);
  assert.equal(model.attackDamage, 60);
});

test("攻击时挥动镐子并在 400ms 内击杀 100 血植物", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(MinerZombieData, { col: 8, row: 2 });
  const target = makePlantTarget({ col: 7, row: 2, hp: 100 });

  model.tryStartAttack(entity, target);
  assert.equal(model.weaponSwinging, true);

  tick(sim, 400);
  assert.equal(target.model.health, 0);
  assert.equal(target.destroyed, true);
  assert.equal(model.weaponSwinging, false);
});

test("手动停止攻击会结束武器挥动", () => {
  resetSim();
  const { model, entity } = spawnMob(MinerZombieData, { col: 8, row: 2 });
  const target = makePlantTarget({ col: 7, row: 2, hp: 100 });
  model.tryStartAttack(entity, target);

  model.stopAttacking(entity);
  assert.equal(model.weaponSwinging, false);
  assert.equal(model.isStop, false);
});
