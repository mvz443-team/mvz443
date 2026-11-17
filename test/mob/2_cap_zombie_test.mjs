import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob } from "../harness/sim.mjs";
import { CapZombieData } from "../../src/game/presets/monster/zombie/cap_zombie.ts";

/**
 * 描述（CapZombie）：
 *   戴皮革帽的僵尸，帽子额外 370 血、阈值 250/125，优先吸收伤害；
 *   帽子破碎后溢出伤害才进入本体血量。
 *
 * 验收路径：
 *   1) onCreate 后读取 helmetDef / helmetHealth / helmetKey。
 *   2) 直接调用 Model 的 absorbHelmetDamage，验证减伤与溢出。
 *
 * 预期结果：
 *   初始帽子 370；100 伤害后帽子 270、本体 300；
 *   再 300 伤害：帽子破碎，溢出 30，本体 270。
 *
 * 为什么：
 *   CAP_HELMET.maxHealth=370，无 damageScale；
 *   absorbHelmetDamage 在 scaled >= helmetHealth 时计算 overflow=scaled-health，
 *   置 helmetBroken 后调用 Model.takeDamage(overflow)。
 */

test("皮革帽初始 370 血并优先吸收伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(CapZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 2);
  assert.equal(model.helmetKey, "attach/cap");
  assert.equal(model.helmetHealth, 370);
  assert.deepEqual(model.helmetDef.thresholds, [250, 125]);

  assert.equal(model.absorbHelmetDamage(entity, 100), true);
  assert.equal(model.helmetHealth, 270);
  assert.equal(model.health, 300);
});

test("帽子破碎时溢出 30 点伤害进入本体", () => {
  resetSim();
  const { model, entity } = spawnMob(CapZombieData, { col: 8, row: 2 });
  model.absorbHelmetDamage(entity, 100);

  assert.equal(model.absorbHelmetDamage(entity, 300), true);
  assert.equal(model.helmetHealth, 0);
  assert.equal(model.helmetBroken, true);
  assert.equal(model.health, 270);
});

test("帽子破碎后不再吸收伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(CapZombieData, { col: 8, row: 2 });
  model.absorbHelmetDamage(entity, 400);

  assert.equal(model.helmetBroken, true);
  assert.equal(model.absorbHelmetDamage(entity, 100), false);
  assert.equal(model.health, 270);
});
