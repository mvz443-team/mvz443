import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget, PlantCmd } from "../harness/sim.mjs";
import { CentipedeMinionData } from "../../src/game/presets/monster/centipede/centipede_minion.ts";

/**
 * 描述（CentipedeMinion）：
 *   蜈蚣幼虫不进行普通近战，而是直接秒杀植物；
 *   对非植物目标仍走普通攻击流程。
 *
 * 验收路径：
 *   1) 检查 shouldInstakill 对植物/非植物的返回值。
 *   2) 调用 instakill，检查 PlantCmd.DealDamage 的伤害值。
 *   3) 检查基础数值与不可携带星之碎片。
 *
 * 预期结果：
 *   植物 true、普通对象 false；伤害为 SECKILL/2=49944994；
 *   500 血、速度 20、couldCarryStarShards=false。
 *
 * 为什么：
 *   shouldInstakill 用 target instanceof PlantEntity；
 *   instakill 调 PlantCmd.DealDamage(target, DamageConstants.SECKILL/2)。
 */

test("只对植物判定为秒杀目标", () => {
  resetSim();
  const { model } = spawnMob(CentipedeMinionData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 7, row: 2 });

  assert.equal(model.shouldInstakill(plant), true);
  assert.equal(model.shouldInstakill({}), false);
});

test("秒杀植物时造成 SECKILL/2 伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(CentipedeMinionData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 7, row: 2, hp: 300 });

  model.instakill(entity, plant);

  assert.deepEqual(PlantCmd.calls, [
    { kind: "damage", plant, amount: 49944994, dealer: entity },
  ]);
  assert.equal(plant.model.health, 0);
  assert.equal(plant.destroyed, true);
});

test("幼虫基础数值", () => {
  resetSim();
  const { model } = spawnMob(CentipedeMinionData, { col: 8, row: 2 });

  assert.equal(model.mid, 18);
  assert.equal(model.health, 500);
  assert.equal(model.baseSpeed, 20);
  assert.equal(model.couldCarryStarShards, false);
});
