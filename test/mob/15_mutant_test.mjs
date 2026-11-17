import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget, tick, MobCmd } from "../harness/sim.mjs";
import { MutantData } from "../../src/game/presets/monster/mutant/mutant.ts";

/**
 * 描述（Mutant）：
 *   变异体攻击植物时会先蓄力 1500ms，再对目标格造成 5500 范围伤害；
 *   同一格内多个植物会一起进入攻击队列；不同格目标会排队到本轮恢复后。
 *
 * 验收路径：
 *   1) queueAttackTarget 一个植物，检查 DamagePlantsInCells(5500)。
 *   2) 检查 isAttacking / isStop / weaponSwinging。
 *   3) 推进 1500ms 检查恢复移动。
 *   4) 攻击中登记不同格植物，恢复后应自动开始第二轮攻击。
 *
 * 预期结果：
 *   第一次伤害 cells=[植物格]、damage=5500；1500ms 后 isAttacking=false、
 *   isStop=false、moveCalls 含 start；不同格目标在恢复后收到第二次 5500。
 *
 * 为什么：
 *   startAttackProcess 调 raw.startLeftArmSmash(callback)，测试替身同步回调；
 *   callback 中 MobCmd.DamagePlantsInCells(cells, smashDamage=5500) 并
 *   schedule(Recover,1500)；finishRecover 优先处理 preAttackedPlant。
 */

test("蓄力攻击对目标格造成 5500 伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(MutantData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 7, row: 2 });

  model.queueAttackTarget(entity, plant);

  const damage = MobCmd.calls.find((call) => call.kind === "damageCells");
  assert.deepEqual(damage.cells, [{ col: 7, row: 2 }]);
  assert.equal(damage.damage, 5500);
  assert.equal(entity.isAttacking, true);
  assert.equal(model.isStop, true);
  assert.equal(model.weaponSwinging, true);
  assert.equal(model.canStartMove(entity), false);
});

test("1500ms 后恢复并重新开始移动", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(MutantData, { col: 8, row: 2 });
  model.queueAttackTarget(entity, makePlantTarget({ col: 7, row: 2 }));

  tick(sim, 1_500);

  assert.equal(entity.isAttacking, false);
  assert.equal(model.isStop, false);
  assert.equal(model.weaponSwinging, false);
  assert.equal(model.canStartMove(entity), true);
  assert.equal(entity.moveCalls.includes("start"), true);
});

test("攻击中登记的不同格目标会在恢复后继续攻击", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(MutantData, { col: 8, row: 2 });
  const first = makePlantTarget({ col: 7, row: 2 });
  const second = makePlantTarget({ col: 6, row: 2 });

  model.queueAttackTarget(entity, first);
  model.queueAttackTarget(entity, second);
  assert.equal(entity.preAttackedPlant, second);
  assert.equal(MobCmd.calls.filter((call) => call.kind === "damageCells").length, 1);

  tick(sim, 1_500);
  const damages = MobCmd.calls.filter((call) => call.kind === "damageCells");
  assert.equal(damages.length, 2);
  assert.deepEqual(damages[1].cells, [{ col: 6, row: 2 }]);
  assert.equal(damages[1].damage, 5500);
});

test("clearAttackState 清空队列与计时器", () => {
  resetSim();
  const { model, entity } = spawnMob(MutantData, { col: 8, row: 2 });
  model.queueAttackTarget(entity, makePlantTarget({ col: 7, row: 2 }));

  model.clearAttackState(entity);

  assert.equal(entity.isAttacking, false);
  assert.equal(model.isStop, false);
  assert.equal(entity.attackedPlants.length, 0);
  assert.equal(entity.preAttackedPlant, null);
  assert.equal(entity.attacking, null);
});
