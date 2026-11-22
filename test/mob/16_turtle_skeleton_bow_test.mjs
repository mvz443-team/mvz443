import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, tick, ProjectileCmd } from "../harness/sim.mjs";
import { TurtleSkeletonBowData } from "../../src/game/presets/monster/zombie/turtle_skeleton_bow.ts";

/**
 * 描述（TurtleSkeletonBow）：
 *   龟壳弓手每 2000ms 射出一发 50 伤害的箭；龟壳 375 血、减伤 0.5；
 *   龟壳破碎后速度翻倍，并每 600ms 连射一发 90 伤害的箭，共 5 发。
 *
 * 验收路径：
 *   1) 有视线目标推进 2000ms，检查普通箭伤害 50。
 *   2) 将本体血量抬高到 2000，调用 absorbShieldDamage 击碎龟壳。
 *   3) 推进 2400ms，统计伤害 90 的连射箭。
 *   4) 检查速度翻倍与 shieldBreakOverflow 返回完整伤害。
 *
 * 预期结果：
 *   2000ms 普通箭 50；龟壳 375、减伤 0.5；
 *   800 伤害使盾承受 400、破盾溢出 800、速度×2；
 *   2400ms 内 5 发 90 伤害箭（另可能有 1 发普通箭）。
 *
 * 为什么：
 *   SkeletonBowModel 的 Shoot 间隔 2000，TurtleSkeletonBowModel 改为
 *   arrowDamage=50；onShieldBroken 排 5 个 Burst(0/600/1200/1800/2400)；
 *   shieldBreakOverflow 返回 amount，因此破盾当次按完整伤害结算。
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

test("龟壳破碎后速度翻倍并连射 5 发 90 伤害箭", () => {
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
  assert.equal(model.speed, originalSpeed * 2);
  assert.equal(model.health, 1_200);

  tick(sim, 2_400);
  const burstArrows = ProjectileCmd.calls.filter(
    (call) => call.kind === "create" && call.cfg.damage === 90,
  );
  assert.equal(burstArrows.length, 5);
  assert.equal(burstArrows.every((call) => call.cfg.speed < 0), true);
});
