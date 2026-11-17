import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, ProjectileCmd, levelValues } from "../harness/sim.mjs";
import { IceBombData } from "../../src/game/presets/plant/chapter1/ice_bomb.ts";

/**
 * 描述（ice_bomb_description）：
 *   寒冰炸弹是夜间植物；睡眠或星碎时触发。先冻结全场 8s，再减速 5s，随后销毁。
 *   1 级伤害 15（随等级增长，5 级起 350）。
 *
 * 验收路径：
 *   以“出生即睡眠”的方式创建，避免 onCreate 立即触发。
 *   1) onStarShards 触发后 500ms 检查冻结激光：每行一条，共 rows 条。
 *   2) 8.5s 后检查减速激光并销毁。
 *   3) Lv5 检查伤害 350。
 *   4) 重复 onStarShards 不重复触发。
 *
 * 预期结果：
 *   5 行 -> 5 条 frozen 激光，伤害 15（Lv1）/350（Lv5）；
 *   8.5s 后 5 条 slow 激光且实体销毁；重复星碎仍只有一组。
 *
 * 为什么：
 *   shootLaser 用 hasTriggered 防重入，延迟 500ms 发 frozen，
 *   再延迟 500 + 8000ms 发 slow 并 destroy；行数来自 PositionManager.Row_Number。
 *   damage = LevelScaledValue(15).setIncRatio(2).setThreshold(5, 350)，
 *   1 级取基础值 15（源码注释“1-4 级 30”与实现不一致）。
 */

function spawnSleeping(level) {
  const sim = resetSim({ rows: 5 });
  const spawned = spawnPlant(IceBombData, { level, initialize: false });
  spawned.model.isSleeping = true;
  spawned.entity.initializeEntity();
  return { sim, ...spawned };
}

test("睡眠触发后冻结全场 8s，再减速并销毁", () => {
  const { sim, model, entity } = spawnSleeping(1);

  model.onStarShards(entity);
  tick(sim, 500);
  const frozen = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  assert.equal(frozen.length, 5);
  assert.ok(frozen.every((call) => call.cfg.debuff === "frozen"));
  assert.ok(frozen.every((call) => call.cfg.damage === 15));
  assert.ok(frozen.every((call) => call.cfg.duration === 8000));

  tick(sim, 8_000);
  const all = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  const slow = all.filter((call) => call.cfg.debuff === "slow");
  assert.equal(all.length, 10);
  assert.equal(slow.length, 5);
  assert.ok(slow.every((call) => call.cfg.duration === 5000));
  assert.equal(entity.destroyed, true);
});

test("Lv5 冻结/减速激光伤害提升到 350", () => {
  const { sim, model, entity } = spawnSleeping(5);
  model.onStarShards(entity);
  tick(sim, 500);
  assert.ok(ProjectileCmd.calls.every((call) => call.cfg.damage === 350));
});

test("hasTriggered 防止重复触发", () => {
  const { sim, model, entity } = spawnSleeping(1);
  model.onStarShards(entity);
  model.onStarShards(entity);
  tick(sim, 500);
  assert.equal(ProjectileCmd.calls.length, 5);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   1–4 级伤害按 2 的对数曲线成长，5 级突变为 350 后继续成长；
 *   9 级冷却从 52s 降到 41s。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：damage = LevelScaledValue(15).setIncRatio(2).setThreshold(5, 350)，
 *   cooldown = LevelScaledValue(52000).setThreshold(9, 41000)。
 */
test("Lv1–Lv9 伤害与冷却成长表", () => {
  assert.deepEqual(
    levelValues((level) => IceBombData.damage.getValueAt(level)),
    [15, 19.732, 22.5, 24.464, 350, 460.413, 525, 570.825, 606.37],
  );
  assert.deepEqual(
    levelValues((level) => IceBombData.cooldown.getValueAt(level)),
    [52000, 52000, 52000, 52000, 52000, 52000, 52000, 52000, 41000],
  );
});
