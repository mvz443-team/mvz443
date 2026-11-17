import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob } from "../harness/sim.mjs";
import { HelmetZombieData } from "../../src/game/presets/monster/zombie/helmet_zombie.ts";

/**
 * 描述（HelmetZombie）：
 *   钢盔僵尸，钢盔额外 1100 血，阈值 733.33/366.67；
 *   钢盔按 1:1 吸收伤害，破碎溢出进入本体。
 *
 * 验收路径：
 *   连续调用 Model.absorbHelmetDamage，记录每次剩余护甲与本体血量。
 *
 * 预期结果：
 *   400 → 700；再 400 → 300；再 400 → 溢出 100，本体 200、钢盔破碎。
 *
 * 为什么：
 *   STEEL_HELMET.maxHealth=1100，thresholds=[1100*2/3, 1100/3]；
 *   第三次 scaled=400 > 300，overflow=100。
 */

test("钢盔 1100 血并按 1:1 吸收", () => {
  resetSim();
  const { model, entity } = spawnMob(HelmetZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 3);
  assert.equal(model.helmetKey, "attach/helmet");
  assert.equal(model.helmetHealth, 1100);
  assert.equal(model.helmetDef.thresholds[0], 1100 * 2 / 3);

  model.absorbHelmetDamage(entity, 400);
  assert.equal(model.helmetHealth, 700);
  assert.equal(model.health, 300);

  model.absorbHelmetDamage(entity, 400);
  assert.equal(model.helmetHealth, 300);
  assert.equal(model.health, 300);
});

test("钢盔破碎溢出 100 点伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(HelmetZombieData, { col: 8, row: 2 });
  model.absorbHelmetDamage(entity, 400);
  model.absorbHelmetDamage(entity, 400);

  model.absorbHelmetDamage(entity, 400);
  assert.equal(model.helmetHealth, 0);
  assert.equal(model.helmetBroken, true);
  assert.equal(model.health, 200);
});
