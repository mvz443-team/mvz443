import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  tick,
  getPlantsMap,
  SfxCmd,
  levelValues,
} from "../harness/sim.mjs";
import { GlowPowderData } from "../../src/game/presets/plant/chapter2/glow_powder.ts";
import { GeneratorData } from "../../src/game/presets/plant/chapter1/generator.ts";

/**
 * 描述（glow_powder_description）：
 *   发光粉是即时效果器械：种下后唤醒同一格的其他器械，播放一次粉末特效，
 *   300ms 后销毁自身；自身拥有 SECKILL 级血量，5 级起消耗从 75 降到 50。
 *
 * 验收路径：
 *   1) 同格放入一个睡眠植物，创建 GlowPowder 后检查其 isSleeping。
 *   2) 不同格植物不应被唤醒。
 *   3) 检查 createVisualEffect 记录与 300ms 后销毁。
 *   4) 检查 maxHealth / cost 阈值。
 *
 * 预期结果：
 *   同格睡眠植物变为清醒，异格保持睡眠；300ms 后自身 destroyed=true；
 *   maxHealth=99889988；Lv1 消耗 75，Lv5 消耗 50。
 *
 * 为什么：
 *   onCreate 调用 entity.awakePlantsInGrid()（遍历 PlantsMap 同 key），
 *   再用 tickmanager.delayedCall(300) 销毁；SECKILL=99889988；
 *   cost = LevelScaledValue(75).setThreshold(5, 50)。
 */

test("唤醒同格其他植物，不唤醒异格植物", () => {
  resetSim();
  const sameGrid = spawnPlant(GeneratorData, { level: 1, col: 4, row: 2 });
  const otherGrid = spawnPlant(GeneratorData, { level: 1, col: 5, row: 2 });
  sameGrid.model.isSleeping = true;
  otherGrid.model.isSleeping = true;
  getPlantsMap().set("4-2", [sameGrid.entity]);
  getPlantsMap().set("5-2", [otherGrid.entity]);

  const { model } = spawnPlant(GlowPowderData, { level: 1, col: 4, row: 2 });
  getPlantsMap().set("4-2", [sameGrid.entity, model]);

  assert.equal(sameGrid.model.isSleeping, false);
  assert.equal(otherGrid.model.isSleeping, true);
});

test("播放特效并在 300ms 后销毁自身", () => {
  const sim = resetSim();
  SfxCmd.reset();
  const { entity } = spawnPlant(GlowPowderData, { level: 1, col: 4, row: 2 });

  assert.equal(entity.viewCalls.includes("createVisualEffect"), true);
  assert.equal(SfxCmd.calls.length, 1);

  tick(sim, 250);
  assert.equal(entity.destroyed, undefined);
  tick(sim, 50);
  assert.equal(entity.destroyed, true);
});

test("血量与 5 级消耗阈值", () => {
  resetSim();
  assert.equal(GlowPowderData.maxHealth.getValueAt(1), 99889988);
  assert.equal(GlowPowderData.cost.getValueAt(1), 75);
  assert.equal(GlowPowderData.cost.getValueAt(4), 75);
  assert.equal(GlowPowderData.cost.getValueAt(5), 50);
  assert.equal(GlowPowderData.cost.getValueAt(9), 50);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   SECKILL 血量恒定；5 级消耗从 75 降到 50；
 *   冷却按 0.6 的对数曲线从 14s 缩短到 8.4s。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：maxHealth / cost / cooldown 都是 GlowPowderData 的 Model 数值。
 */
test("Lv1–Lv9 血量、消耗与冷却成长表", () => {
  assert.deepEqual(
    levelValues((level) => GlowPowderData.maxHealth.getValueAt(level)),
    [99889988, 99889988, 99889988, 99889988, 99889988, 99889988, 99889988, 99889988, 99889988],
  );
  assert.deepEqual(
    levelValues((level) => GlowPowderData.cost.getValueAt(level)),
    [75, 75, 75, 75, 50, 50, 50, 50, 50],
  );
  assert.deepEqual(
    levelValues((level) => GlowPowderData.cooldown.getValueAt(level)),
    [14000, 12233.397, 11200, 10466.793, 9898.074, 9433.397, 9040.518, 8700.19, 8400],
  );
});
