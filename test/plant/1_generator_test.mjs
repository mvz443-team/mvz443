import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  getPlantsMap,
  getResourceState,
  levelValues,
} from "../harness/sim.mjs";
import { GeneratorData } from "../../src/game/presets/plant/chapter1/generator.ts";

/**
 * 描述（generator_description）：
 *   发电机受到伤害时把伤害转成能量；睡眠时产能下降；星之碎片唤醒 3x3 内队友并回满自身血量。
 *
 * 验收路径：
 *   直接调用真实 GeneratorModel.onHurt / onStarShards。
 *   1) 每累计 20 点伤害触发一次产能。
 *   2) 清醒 Lv1 = 5，Lv3 = 5，Lv7 = 8；睡眠 Lv1 = 3，Lv3 = 4，Lv7 = 6。
 *   3) 星碎后 3x3 内植物 isSleeping = false，自身 health 回到 max。
 *
 * 预期结果：
 *   40 伤害 -> 10 能量；睡眠 Lv1 20 伤害 -> 3；Lv3 睡眠 -> 4；Lv7 清醒 -> 8；
 *   星碎后 3x3 内植物全部清醒。
 *
 * 为什么：
 *   onHurt 的 while(damagedSum >= 20) 每次扣 20 并累加 energyToAdd；
 *   睡眠/清醒分支与 LevelThresholds1=3、LevelThresholds2=7 对应：
 *   光敏作物在阳光强烈时睡眠，3 级提高睡眠产能，7 级提高全天候产能。
 */

test("每 20 点伤害转化一次能量", () => {
  resetSim();
  const { model, entity } = spawnPlant(GeneratorData, { level: 1 });

  model.onHurt(entity, 40, 40);
  assert.equal(entity.damagedSum, 0);
  assert.deepEqual(getResourceState().energyCalls, [10]);

  model.onHurt(entity, 19, 19);
  assert.equal(getResourceState().energyCalls.length, 1);
  model.onHurt(entity, 1, 1);
  assert.equal(getResourceState().energyCalls.length, 2);
  assert.equal(getResourceState().energyCalls[1], 5);
});

test("3 级提高睡眠产能，7 级提高全天候产能", () => {
  resetSim();
  const lv1 = spawnPlant(GeneratorData, { level: 1 });
  lv1.model.onHurt(lv1.entity, 20, 20);
  assert.equal(getResourceState().energyCalls.at(-1), 5);

  resetSim();
  const lv3 = spawnPlant(GeneratorData, { level: 3 });
  lv3.model.onHurt(lv3.entity, 20, 20);
  assert.equal(getResourceState().energyCalls.at(-1), 5);

  resetSim();
  const lv3sleep = spawnPlant(GeneratorData, { level: 3 });
  lv3sleep.model.isSleeping = true;
  lv3sleep.model.onHurt(lv3sleep.entity, 20, 20);
  assert.equal(getResourceState().energyCalls.at(-1), 4);

  resetSim();
  const lv7sleep = spawnPlant(GeneratorData, { level: 7 });
  lv7sleep.model.isSleeping = true;
  lv7sleep.model.onHurt(lv7sleep.entity, 20, 20);
  assert.equal(getResourceState().energyCalls.at(-1), 6);

  resetSim();
  const lv7awake = spawnPlant(GeneratorData, { level: 7 });
  lv7awake.model.onHurt(lv7awake.entity, 20, 20);
  assert.equal(getResourceState().energyCalls.at(-1), 8);
});

test("星之碎片唤醒 3x3 内植物并回满自身", () => {
  resetSim();
  const self = spawnPlant(GeneratorData, { level: 1, col: 4, row: 2 });
  const neighbor = spawnPlant(GeneratorData, { level: 1, col: 5, row: 3 });
  neighbor.model.isSleeping = true;
  getPlantsMap().set("5-3", [neighbor.entity]);
  self.model.health = 100;

  self.model.onStarShards(self.entity);

  assert.equal(neighbor.model.isSleeping, false);
  assert.equal(self.model.health, self.model.healthMax);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   清醒时 1–6 级每 20 伤害产 5 能量，7–9 级产 8；
 *   睡眠时 1–2 级产 3，3–6 级产 4，7–9 级产 6。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：onHurt 的睡眠/清醒分支使用 LevelThresholds1=3、LevelThresholds2=7；
 *   3 级提高阳光强烈（睡眠）效率，7 级提高全天候效率。
 */
test("Lv1–Lv9 清醒/睡眠产能表", () => {
  const awakeEnergy = [5, 5, 5, 5, 5, 5, 8, 8, 8];
  const sleepingEnergy = [3, 3, 4, 4, 4, 4, 6, 6, 6];

  for (let level = 1; level <= 9; level++) {
    resetSim();
    const awake = spawnPlant(GeneratorData, { level });
    awake.model.onHurt(awake.entity, 20, 20);
    assert.equal(getResourceState().energyCalls.at(-1), awakeEnergy[level - 1]);

    resetSim();
    const sleeping = spawnPlant(GeneratorData, { level });
    sleeping.model.isSleeping = true;
    sleeping.model.onHurt(sleeping.entity, 20, 20);
    assert.equal(getResourceState().energyCalls.at(-1), sleepingEnergy[level - 1]);
  }
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   发电机基础血量按 1.2 的对数曲线成长，其余基础消耗/冷却不变。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：maxHealth = LevelScaledValue(800).setIncRatio(1.2)。
 */
test("Lv1–Lv9 基础血量成长表", () => {
  assert.deepEqual(
    levelValues((level) => GeneratorData.maxHealth.getValueAt(level)),
    [800, 850.474, 880, 900.949, 917.198, 930.474, 941.699, 951.423, 960],
  );
  assert.deepEqual(
    levelValues((level) => GeneratorData.cost.getValueAt(level)),
    [50, 50, 50, 50, 50, 50, 50, 50, 50],
  );
});
