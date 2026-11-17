import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  setGridType,
  getPlantsMap,
  PlantCmd,
  levelValues,
} from "../harness/sim.mjs";
import { LilyData } from "../../src/game/presets/plant/chapter1/lily.ts";

/**
 * 描述（lily_description）：
 *   睡莲是水面承载物，本身低矮；5 级起消耗为 0。
 *   星之碎片：在周围 3x3 的水格补种睡莲，已有睡莲的格子不重复种。
 *
 * 验收路径：
 *   用 GridManager 替身设置水格，注册一个已存在的睡莲，调用真实 onStarShards。
 *
 * 预期结果：
 *   只在水格创建睡莲；跳过自身与已有睡莲；Lv5 cost = 0；isTiny = true。
 *
 * 为什么：
 *   onStarShards 遍历 col±1 / row±1，检查 gridProp.type === 'water'，
 *   并通过 PlantsManager.PlantsMap 查找同格已有 lily。
 */

test("星之碎片只在水格补种睡莲，并跳过自身/已有睡莲", () => {
  resetSim();
  setGridType(0, 0, "water");
  setGridType(1, 0, "water");
  setGridType(2, 1, "water");
  setGridType(2, 2, "ground");

  const lily = spawnPlant(LilyData, { level: 1, col: 1, row: 1 });
  const existing = spawnPlant(LilyData, { level: 1, col: 1, row: 0 });
  getPlantsMap().set("1-0", [existing.entity]);

  lily.model.onStarShards(lily.entity);

  const created = PlantCmd.calls.filter((call) => call.kind === "create");
  assert.deepEqual(
    created.map((call) => [call.col, call.row]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    [[0, 0], [2, 1]],
  );
});

test("睡莲 5 级免能量且为低矮植物", () => {
  resetSim();
  assert.equal(LilyData.cost.getValueAt(5), 0);
  assert.equal(LilyData.isTiny, true);
  assert.equal(LilyData.maxHealth.getValueAt(1), 300);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   睡莲血量按 2 的对数曲线成长；5 级起消耗从 25 降为 0。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：maxHealth = LevelScaledValue(300).setIncRatio(2)，
 *   cost = LevelScaledValue(25).setThreshold(5, 0)。
 */
test("Lv1–Lv9 血量与消耗成长表", () => {
  assert.deepEqual(
    levelValues((level) => LilyData.maxHealth.getValueAt(level)),
    [300, 394.639, 450, 489.279, 519.746, 544.639, 565.687, 583.918, 600],
  );
  assert.deepEqual(
    levelValues((level) => LilyData.cost.getValueAt(level)),
    [25, 25, 25, 25, 0, 0, 0, 0, 0],
  );
});
