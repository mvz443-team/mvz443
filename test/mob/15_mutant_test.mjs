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
 *   1) queueAttackTarget 后先检查未立即造成伤害，推进 1500ms 再检查
 *      DamagePlantsInCells(5500)（伤害由 Model 的 tickmanager 驱动，不依赖
 *      Phaser tween onComplete）。
 *   2) 检查 isAttacking / isStop / weaponSwinging。
 *   3) 推进到 3000ms（蓄力 1500 + 恢复 1500）检查恢复移动。
 *   4) 攻击中登记不同格植物，恢复后再蓄力 1500ms 后开始第二轮攻击。
 *
 * 预期结果：
 *   蓄力期间无伤害；1500ms 后第一次 cells=[植物格]、damage=5500；
 *   3000ms 后 isAttacking=false、isStop=false、moveCalls 含 start；
 *   不同格目标在 4500ms 收到第二次 5500。
 *
 * 为什么：
 *   startAttackProcess 用 tickmanager.schedule(Smash, chargeMs=1500) 驱动伤害，
 *   raw.startLeftArmSmash() 只播放表现；Smash 回调中
 *   MobCmd.DamagePlantsInCells(cells, smashDamage=5500) 并
 *   schedule(Recover,1500)；finishRecover 优先处理 preAttackedPlant。
 *   这样回滚后伤害与恢复时机由权威帧决定，不会因 tween 时钟差异分叉。
 */

test("蓄力 1500ms 后对目标格造成 5500 伤害", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(MutantData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 7, row: 2 });

  model.queueAttackTarget(entity, plant);
  assert.equal(MobCmd.calls.filter((call) => call.kind === "damageCells").length, 0);
  assert.equal(entity.isAttacking, true);
  assert.equal(model.isStop, true);
  assert.equal(model.weaponSwinging, true);
  assert.equal(model.canStartMove(entity), false);

  tick(sim, 1_500);

  const damage = MobCmd.calls.find((call) => call.kind === "damageCells");
  assert.deepEqual(damage.cells, [{ col: 7, row: 2 }]);
  assert.equal(damage.damage, 5500);
});

test("砸击后 1500ms 恢复并重新开始移动", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(MutantData, { col: 8, row: 2 });
  model.queueAttackTarget(entity, makePlantTarget({ col: 7, row: 2 }));

  tick(sim, 3_000);

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

  tick(sim, 1_500);
  let damages = MobCmd.calls.filter((call) => call.kind === "damageCells");
  assert.equal(damages.length, 1);
  assert.deepEqual(damages[0].cells, [{ col: 7, row: 2 }]);

  tick(sim, 3_000);
  damages = MobCmd.calls.filter((call) => call.kind === "damageCells");
  assert.equal(damages.length, 2);
  assert.deepEqual(damages[1].cells, [{ col: 6, row: 2 }]);
  assert.equal(damages[1].damage, 5500);
});

test("clearAttackState 清空队列与计时器并阻止待触发伤害", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(MutantData, { col: 8, row: 2 });
  model.queueAttackTarget(entity, makePlantTarget({ col: 7, row: 2 }));

  model.clearAttackState(entity);
  tick(sim, 1_500);

  assert.equal(entity.isAttacking, false);
  assert.equal(model.isStop, false);
  assert.equal(entity.attackedPlants.length, 0);
  assert.equal(entity.preAttackedPlant, null);
  assert.equal(entity.attacking, null);
  assert.equal(MobCmd.calls.filter((call) => call.kind === "damageCells").length, 0);
});
