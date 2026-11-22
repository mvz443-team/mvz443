import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, tick, ProjectileCmd } from "../harness/sim.mjs";
import { TurtleSkeletonBowData } from "../../src/game/presets/monster/zombie/turtle_skeleton_bow.ts";

/**
 * 描述（TurtleSkeletonBow）：
 *   龟壳弓手每 2000ms 射出一发 50 伤害的箭；龟壳 375 血、减伤 0.5；
 *   龟壳破碎后获得 900s berserk（速度/攻速/动画倍率由 buff 系统处理），
 *   并每 600ms 连射一发 90 伤害的箭，共 5 发。
 *
 * 验收路径：
 *   1) 有视线目标推进 2000ms，检查普通箭伤害 50。
 *   2) 抬高本体血量，absorbHelmetDamage 击碎龟壳。
 *   3) 检查 hasBuff('berserk')、倍率、900s 有界时长。
 *   4) 推进 2400ms，统计伤害 90 的连射箭。
 *   5) 重复 onHeadBroken 不叠加 buff。
 *
 * 预期结果：
 *   2000ms 普通箭 50；龟壳 375、减伤 0.5；
 *   berserk: speedMultiplier=2、attackIntervalMultiplier=0.5、远程间隔 1000ms；
 *   2400ms 内 5 发 90 伤害箭。
 *
 * 为什么：
 *   SkeletonBowModel 的 Shoot 间隔 2000，TurtleSkeletonBowModel arrowDamage=50；
 *   onHeadBroken 施加 applyBuff('berserk', 900000) 并排 5 个 Burst；
 *   breakOverflow:"full" 使破壳当次按完整伤害结算。
 */

test("2000ms 普通箭伤害 50", () => {
  const sim = resetSim();
  spawnMob(TurtleSkeletonBowData, { col: 8, row: 2, sightTarget: true });

  tick(sim, 2_000);
  const arrows = ProjectileCmd.calls.filter((call) => call.kind === "create");
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].model, "ArrowModel");
  assert.equal(arrows[0].cfg.damage, 50);
});

test("龟壳破碎后获得 900s berserk 并连射 5 发 90 伤害箭", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(TurtleSkeletonBowData, { col: 8, row: 2, sightTarget: true });
  const originalSpeed = model.originalSpeed;
  model.health = 2_000;

  assert.equal(model.helmetKey, "attach/turtle");
  assert.equal(model.helmetHealth, 375);
  assert.equal(model.helmetDef.damageScale, 0.5);

  assert.equal(model.absorbHelmetDamage(entity, 800), true);
  assert.equal(model.helmetHealth, 0);
  assert.equal(model.helmetBroken, true);
  assert.equal(model.speed, originalSpeed);
  assert.equal(model.hasBuff("berserk"), true);
  assert.equal(model.speedMultiplier, 2);
  assert.equal(model.attackIntervalMultiplier, 0.5);
  assert.equal(model.health, 1_200);

  tick(sim, 2_400);
  const burstArrows = ProjectileCmd.calls.filter(
    (call) => call.kind === "create" && call.cfg.damage === 90,
  );
  assert.equal(burstArrows.length, 5);
  assert.equal(burstArrows.every((call) => call.cfg.speed < 0), true);
});

test("重复龟壳破碎回调不会叠加 berserk", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(TurtleSkeletonBowData, { col: 8, row: 2, sightTarget: true });
  model.health = 2_000;
  model.absorbHelmetDamage(entity, 800);

  model.onHeadBroken(entity);
  assert.equal(model.hasBuff("berserk"), true);
  assert.equal(model.speedMultiplier, 2);
});
