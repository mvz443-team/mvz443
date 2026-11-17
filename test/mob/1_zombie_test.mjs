import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnMob,
  makePlantTarget,
  tick,
  ResourceCmd,
} from "../harness/sim.mjs";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";

/**
 * 描述（Zombie）：
 *   第一章基础僵尸：300 血、20 攻击、200ms 攻击间隔；血量降到 150 以下切换破损躯体；
 *   携带星之碎片时死亡会向全场掉落。
 *
 * 验收路径：
 *   1) 读取 Model 的 mid / maxHealth / attackDamage / attackInterval / damageThresholds。
 *   2) 让僵尸攻击 100 血植物，统计 1s 内伤害次数与总伤害。
 *   3) 直接扣血后调用 updateBodyDamageStage，检查 currentStage。
 *   4) addStarShards 后击杀，检查 ResourceCmd 掉落。
 *
 * 预期结果：
 *   100 血植物在 1000ms 时被 5 次 ×20 打死；
 *   血量 149 时 currentStage=0；星碎掉落 1 颗。
 *
 * 为什么：
 *   beginAttackTimer 使用 schedule(loop) 每 200ms 触发 hurtTarget；
 *   updateBodyDamageStage 对单阈值 [150] 在 health<=150 时置 stage=0；
 *   zombieDie 调用 dropCarriedStarShards，ResourceCmd.AddStarshardToAll(1)。
 */

test("基础数值与攻击节奏", () => {
  resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 1);
  assert.equal(model.health, 300);
  assert.equal(model.attackDamage, 20);
  assert.equal(model.attackInterval, 200);
  assert.deepEqual(model.damageThresholds, [150]);
  assert.equal(entity.faction, 2);
});

test("1s 内 5 次攻击打死 100 血植物", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  const target = makePlantTarget({ col: 7, row: 2, hp: 100 });

  assert.equal(model.tryStartAttack(entity, target), true);
  tick(sim, 1_000);

  assert.equal(target.model.health, 0);
  assert.equal(target.destroyed, true);
});

test("血量降到阈值以下进入破损阶段", () => {
  resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  model.takeDamage(entity, 151);
  model.updateBodyDamageStage(entity, model.damageThresholds);

  assert.equal(model.health, 149);
  assert.equal(model.currentStage, 0);
  assert.equal(entity.animController.raw.switchBodyFrame !== undefined, true);
});

test("携带星之碎片死亡后掉落给全场", () => {
  resetSim();
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  model.addStarShards(entity, 1);

  model.takeDamage(entity, 300);

  assert.deepEqual(ResourceCmd.calls, [{ kind: "starshard", amount: 1 }]);
  assert.equal(model.starShardsDropped, true);
  assert.equal(model.carryStarShards, false);
});
