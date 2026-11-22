import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  applyInstantPlant,
  getPlantsMap,
  SfxCmd,
  levelValues,
} from "../harness/sim.mjs";
import { GlowPowderData } from "../../src/game/presets/plant/chapter2/glow_powder.ts";
import { GeneratorData } from "../../src/game/presets/plant/chapter1/generator.ts";
import PlantHelper from "../../src/game/utils/helper/PlantHelper.ts";

/**
 * 描述（glow_powder_description）：
 *   萤石粉是一次性唤醒植物：只能种在已有存活植物的格子上，
 *   种下后同一确定性帧唤醒整格所有植物并播放一次粉末特效；
 *   不创建 Entity、物理体，也没有 300ms 存活时间。5 级起消耗从 75 降到 50。
 *
 * 验收路径：
 *   1) 同格放入睡眠植物，直接驱动真实 applyInstantEffect，检查 isSleeping。
 *   2) 不同格植物不应被唤醒。
 *   3) 检查 SfxCmd 特效与 PlantsMap 不新增实体。
 *   4) 检查 maxHealth / cost 阈值。
 *
 * 预期结果：
 *   同格睡眠植物变为清醒，异格保持睡眠；不产生任何植物实体；
 *   maxHealth=99889988；Lv1 消耗 75，Lv5 消耗 50。
 *
 * 为什么：
 *   applyInstantEffect 遍历 PlantsMap 同 key 并 setSleeping(false)，
 *   再直接 SfxCmd.Create；PlantsManager 对 isOneTimePlant 不 createEntity。
 */

test("唤醒同格其他植物，不唤醒异格植物", () => {
  resetSim();
  const sameGrid = spawnPlant(GeneratorData, { level: 1, col: 4, row: 2 });
  const otherGrid = spawnPlant(GeneratorData, { level: 1, col: 5, row: 2 });
  sameGrid.model.isSleeping = true;
  otherGrid.model.isSleeping = true;
  getPlantsMap().set("4-2", [sameGrid.entity]);
  getPlantsMap().set("5-2", [otherGrid.entity]);

  applyInstantPlant(GlowPowderData, { level: 1, col: 4, row: 2 });

  assert.equal(sameGrid.model.isSleeping, false);
  assert.equal(otherGrid.model.isSleeping, true);
});

test("播放特效且不创建实体", () => {
  resetSim();
  SfxCmd.reset();
  const before = getPlantsMap().size;
  applyInstantPlant(GlowPowderData, { level: 1, col: 4, row: 2 });

  assert.equal(SfxCmd.calls.length, 1);
  assert.equal(getPlantsMap().size, before, "一次性植物不进入 PlantsMap");
});

test("只能种在已有存活植物的格子上", () => {
  resetSim();
  const existing = spawnPlant(GeneratorData, { level: 1, col: 4, row: 2 });

  assert.equal(
    PlantHelper.CanPlantInGrid([], GlowPowderData.pid, { type: "ground" }, GlowPowderData),
    false,
    "空格子不能种萤石粉",
  );
  assert.equal(
    PlantHelper.CanPlantInGrid([existing.entity], GlowPowderData.pid, { type: "ground" }, GlowPowderData),
    true,
    "已有植物可以种萤石粉",
  );
  assert.equal(GlowPowderData.placementRule, "overlayExisting");
  assert.equal(GlowPowderData.isOneTimePlant, true);
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
