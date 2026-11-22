import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget, tick } from "../harness/sim.mjs";
import { SkeletonData } from "../../src/game/presets/monster/zombie/skeleton.ts";

/**
 * 描述（Skeleton）：
 *   骷髅基础单位：250 血、20 攻击、200ms 间隔，阈值 [100]；
 *   与僵尸共享近战逻辑，但体型/血量更低。
 *
 * 验收路径：
 *   1) 检查基础数值。
 *   2) 攻击 100 血植物并统计击杀时间。
 *   3) 扣血后更新躯体阶段。
 *
 * 预期结果：
 *   250 血、20 伤害、200ms；100 血植物 1s 内死亡；
 *   血量 99 时 currentStage=0。
 *
 * 为什么：
 *   SkeletonData 定义 maxHealth=250、damageThresholds=[100]；
 *   攻击由 MonsterModel.beginAttackTimer 的循环 timer 驱动。
 */

test("骷髅基础数值", () => {
  resetSim();
  const { model } = spawnMob(SkeletonData, { col: 8, row: 2 });

  assert.equal(model.mid, 6);
  assert.equal(model.health, 250);
  assert.equal(model.baseAttackDamage, 20);
  assert.equal(model.attackInterval, 200);
  assert.deepEqual(model.damageThresholds, [100]);
});

test("近战攻击与躯体破损阶段", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(SkeletonData, { col: 8, row: 2 });
  const target = makePlantTarget({ col: 7, row: 2, hp: 100 });

  model.tryStartAttack(entity, target);
  tick(sim, 1_000);
  assert.equal(target.model.health, 0);

  model.takeDamage(entity, 151);
  model.updateBodyDamageStage(entity, model.damageThresholds);
  assert.equal(model.health, 99);
  assert.equal(model.currentStage, 0);
});
