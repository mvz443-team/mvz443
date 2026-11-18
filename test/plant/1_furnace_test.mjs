import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, ResourceCmd, levelValues } from "../harness/sim.mjs";
import { FurnaceData } from "../../src/game/presets/plant/chapter1/furnace.ts";

/**
 * 描述（furnace_description）：
 *   熔炉自动生产红石能量；等级越高产能间隔越短，5 级消耗降为 35，9 级每次产能提升到 40。
 *   星之碎片技能：一次性生成大量红石。
 *
 * 验收路径：
 *   直接驱动真实 FurnaceModel 的 EntityTickManager。
 *   1) Lv1 等待首个产能点（25000 * 0.7 = 17500ms）与下一个 25000ms 周期。
 *   2) Lv9 检查间隔缩短、单次产量 40。
 *   3) 睡眠时定时器到点但不产能。
 *   4) onStarShards 直接加 450 能量。
 *   5) 在 frame 212 创建时，首个定时器 targetFrame 必须是 212 + 150。
 *
 * 预期结果：
 *   Lv1 在 18s 时产能 1 次（25），43s 时 2 次；Lv9 在 15s 时产能 1 次（40）；
 *   睡眠 30s 不产能；星碎 +450；frame 212 创建的 targetFrame=362。
 *
 * 为什么：
 *   generateEnergyCooldown = 25000 * 0.85^(level 曲线)，startAt 为冷却的 70%；
 *   generateEnergyAmount 在 9 级阈值变为 40；onGenerate 明确检查 isSleeping；
 *   timer 起点必须是权威创建帧（否则两端同一操作会得到不同的 targetFrame）。
 */

test("Lv1 熔炉按 17.5s 首次、25s 周期产能", () => {
  const sim = resetSim();
  spawnPlant(FurnaceData, { level: 1 });

  tick(sim, 18_000);
  assert.deepEqual(ResourceCmd.calls, [{ kind: "energy", amount: 25 }]);

  tick(sim, 25_000);
  assert.equal(ResourceCmd.calls.length, 2);
  assert.equal(ResourceCmd.calls[1].amount, 25);
});

test("Lv9 熔炉单次产能提升到 40，且间隔缩短", () => {
  const sim = resetSim();
  spawnPlant(FurnaceData, { level: 9 });

  tick(sim, 15_000);
  assert.deepEqual(ResourceCmd.calls, [{ kind: "energy", amount: 40 }]);
});

test("睡眠中的熔炉不产能", () => {
  const sim = resetSim();
  const { model } = spawnPlant(FurnaceData, { level: 1 });
  model.isSleeping = true;

  tick(sim, 30_000);
  assert.equal(ResourceCmd.calls.length, 0);
});

test("星之碎片一次性增加 450 能量", () => {
  resetSim();
  const { model, entity } = spawnPlant(FurnaceData, { level: 1 });

  model.onStarShards(entity);
  assert.deepEqual(ResourceCmd.calls, [{ kind: "energy", amount: 450 }]);
});

test("首个产能定时器锚定创建帧", () => {
  const sim = resetSim();
  tick(sim, 212 * 50);
  const { model } = spawnPlant(FurnaceData, { level: 1 });

  // 25000ms 冷却，startAt=70% → 首个间隔 ceil((25000-17500)/50)=150 帧。
  assert.equal(model.captureTimers()[0].targetFrame, 212 + 150);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   产能间隔按 0.85 的对数曲线缩短；9 级单次产量从 25 提升到 40；
 *   5 级消耗从 50 降到 35。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：generateEnergyCooldown / generateEnergyAmount / cost 都是 Model 中的 LevelScaledValue。
 */
test("Lv1–Lv9 产能与消耗成长表", () => {
  assert.deepEqual(
    levelValues((level) => FurnaceData.generateEnergyCooldown.getValueAt(level)),
    [25000, 23817.007, 23125, 22634.013, 22253.175, 21942.007, 21678.918, 21451.02, 21250],
  );
  assert.deepEqual(
    levelValues((level) => FurnaceData.generateEnergyAmount.getValueAt(level)),
    [25, 25, 25, 25, 25, 25, 25, 25, 40],
  );
  assert.deepEqual(
    levelValues((level) => FurnaceData.cost.getValueAt(level)),
    [50, 50, 50, 50, 35, 35, 35, 35, 35],
  );
});
