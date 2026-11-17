import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget } from "../harness/sim.mjs";
import { MinerHelmetZombieData } from "../../src/game/presets/monster/zombie/miner_helmet_zombie.ts";

/**
 * 描述（MinerHelmetZombie）：
 *   同时拥有钢盔与镐子：钢盔 1100 血、镐子攻击 60。
 *   两种能力都必须在 onCreate 中由 Model 装备。
 *
 * 验收路径：
 *   1) 检查 helmetKey / weaponKey。
 *   2) 验证钢盔吸收伤害。
 *   3) 验证攻击开始时镐子挥动。
 *
 * 预期结果：
 *   helmet=attach/helmet、weapon=attach/hd_pickaxe；
 *   400 伤害后钢盔 700、本体 300；攻击时 weaponSwinging=true。
 *
 * 为什么：
 *   MinerHelmetZombieModel.onCreate 依次 equipHelmet(STEEL_HELMET)
 *   与 equipWeapon(PICKAXE_WEAPON)，两个 mixin 状态都在 Model。
 */

test("同时装备钢盔与镐子", () => {
  resetSim();
  const { model } = spawnMob(MinerHelmetZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 5);
  assert.equal(model.helmetKey, "attach/helmet");
  assert.equal(model.helmetHealth, 1100);
  assert.equal(model.weaponKey, "attach/hd_pickaxe");
  assert.equal(model.weaponVisible, true);
});

test("钢盔优先吸收，镐子随攻击挥动", () => {
  resetSim();
  const { model, entity } = spawnMob(MinerHelmetZombieData, { col: 8, row: 2 });

  model.absorbHelmetDamage(entity, 400);
  assert.equal(model.helmetHealth, 700);
  assert.equal(model.health, 300);

  const plant = makePlantTarget({ col: 7, row: 2 });
  model.tryStartAttack(entity, plant);
  assert.equal(model.weaponSwinging, true);
});
