import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  tick,
  setSightTarget,
  ProjectileCmd,
  PlantCmd,
  PositionManager,
  levelValues,
} from "../harness/sim.mjs";
import { SmallDispenserData } from "../../src/game/presets/plant/chapter1/small_dispenser.ts";

/**
 * 描述（small_dispenser_description）：
 *   0 费夜间小型发射器，发射短距离雪球；3 级攻击距离中幅增加；
 *   7 级在强光下种植也不会睡眠；星之碎片发射一枚长距离爆炸雪球。
 *
 * 验收路径：
 *   1) 有目标时统计 3s 内 SnowBallModel 数量与 maxDistance。
 *   2) 对比 Lv1/Lv3 的 maxDistance。
 *   3) Lv7 onCreate 应调用 PlantCmd.SetSleeping(false)。
 *   4) 睡眠状态下 onStarShards 先唤醒，再创建 FireBallModel。
 *
 * 预期结果：
 *   Lv1 3s 内 3 发，伤害 24，射程 3.6 格；Lv3 射程 5.6 格；
 *   Lv7 被唤醒；星碎雪球伤害 550（Lv9 660），射程 12 格高。
 *
 * 为什么：
 *   addEvent(startAt=500, delay=1000, loop) 首次在 500ms，之后每 1000ms；
 *   LevelThresholds1=3 控制 3.6→5.6；LevelThresholds2=7 时显式 SetSleeping(false)；
 *   星碎用 LevelScaledValue(550).setIncRatio(1.2) 并乘 GRID_SIZEY*12。
 */

test("Lv1 3s 内 3 发雪球，伤害 24，射程 3.6 格", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(SmallDispenserData, { level: 1, row: 2 });

  tick(sim, 3_000);

  assert.equal(ProjectileCmd.calls.length, 3);
  for (const call of ProjectileCmd.calls) {
    assert.equal(call.model, "SnowBallModel");
    assert.equal(call.cfg.damage, 24);
    assert.equal(call.cfg.maxDistance, PositionManager.Instance.GRID_SIZEX * 3.6);
  }
});

test("Lv3 攻击射程提升到 5.6 格", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(SmallDispenserData, { level: 3, row: 2 });

  tick(sim, 600);
  assert.equal(ProjectileCmd.calls.length, 1);
  assert.equal(ProjectileCmd.calls[0].cfg.maxDistance, PositionManager.Instance.GRID_SIZEX * 5.6);
});

test("Lv7 在白天种植时不会睡眠", () => {
  resetSim();
  const { model } = spawnPlant(SmallDispenserData, { level: 7, row: 2 });

  assert.equal(PlantCmd.calls.some((call) => call.kind === "sleeping" && call.value === false), true);
  assert.equal(model.isSleeping, false);
});

test("星之碎片唤醒自身并发射伤害 550 的长距离爆炸雪球", () => {
  resetSim();
  const { model, entity } = spawnPlant(SmallDispenserData, { level: 1, row: 2 });
  model.isSleeping = true;
  ProjectileCmd.reset();

  model.onStarShards(entity);

  assert.equal(model.isSleeping, false);
  assert.equal(ProjectileCmd.calls.length, 1);
  assert.equal(ProjectileCmd.calls[0].model, "FireBallModel");
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 550);
  assert.equal(ProjectileCmd.calls[0].cfg.maxDistance, PositionManager.Instance.GRID_SIZEY * 12);
});

test("Lv9 星碎爆炸雪球伤害 660", () => {
  resetSim();
  const { model, entity } = spawnPlant(SmallDispenserData, { level: 9, row: 2 });
  ProjectileCmd.reset();

  model.onStarShards(entity);
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 660);
});

test("睡眠时不发射普通雪球", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { model } = spawnPlant(SmallDispenserData, { level: 1, row: 2 });
  model.isSleeping = true;

  tick(sim, 3_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   普通雪球伤害按 1.3 成长；星碎爆炸雪球伤害按 1.2 从 550 成长到 660。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：damage = LevelScaledValue(24).setIncRatio(1.3)，
 *   星碎伤害 = LevelScaledValue(550).setIncRatio(1.2)。
 */
test("Lv1–Lv9 普通与星碎伤害成长表", () => {
  assert.deepEqual(
    levelValues((level) => SmallDispenserData.damage.getValueAt(level)),
    [24, 26.271, 27.6, 28.543, 29.274, 29.871, 30.376, 30.814, 31.2],
  );

  const expectedStarDamage = [550, 584.701, 605, 619.402, 630.574, 639.701, 647.418, 654.103, 660];
  for (let level = 1; level <= 9; level++) {
    resetSim();
    const { model, entity } = spawnPlant(SmallDispenserData, { level, row: 2 });
    ProjectileCmd.reset();
    model.onStarShards(entity);

    assert.equal(ProjectileCmd.calls.length, 1);
    assert.equal(ProjectileCmd.calls[0].model, "FireBallModel");
    assert.equal(ProjectileCmd.calls[0].cfg.damage, expectedStarDamage[level - 1]);
  }
});
