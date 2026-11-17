import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, ProjectileCmd, ResourceCmd, levelValues } from "../harness/sim.mjs";
import { MagicPowderData } from "../../src/game/presets/plant/chapter1/magic_powder.ts";

/**
 * 描述（magic_powder_description）：
 *   魔法粉是瞬发植物：落地立即发射一次近距离激光，并额外获得 1 星之碎片；
 *   300ms 后销毁。9 级激光伤害提升到 2000。
 *
 * 验收路径：
 *   直接驱动真实 onCreate / onStarShards。
 *
 * 预期结果：
 *   Lv1 1 条激光伤害 1500、distance 1.2；+1 星碎；300ms 后 destroyed；
 *   Lv9 伤害 2000；onStarShards 不产生额外效果。
 *
 * 为什么：
 *   shootLaser 立即 CreateLaser，damage = LevelScaledValue(1500).setThreshold(9, 2000)，
 *   随后 tickmanager.delayedCall(300) 销毁；onStarShards 是空实现。
 */

test("Lv1 落地立即发射 1500 伤害激光并 +1 星碎", () => {
  const sim = resetSim();
  const { entity } = spawnPlant(MagicPowderData, { level: 1 });

  assert.equal(ProjectileCmd.calls.length, 1);
  assert.equal(ProjectileCmd.calls[0].kind, "laser");
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 1500);
  assert.equal(ProjectileCmd.calls[0].cfg.distance, 1.2);
  assert.deepEqual(ResourceCmd.calls, [{ kind: "starshard", amount: 1 }]);

  tick(sim, 300);
  assert.equal(entity.destroyed, true);
});

test("Lv9 激光伤害 2000", () => {
  resetSim();
  spawnPlant(MagicPowderData, { level: 9 });
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 2000);
});

test("星之碎片对魔法粉没有额外效果", () => {
  resetSim();
  const { model, entity } = spawnPlant(MagicPowderData, { level: 1 });
  ProjectileCmd.reset();
  model.onStarShards(entity);
  assert.equal(ProjectileCmd.calls.length, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   1–8 级激光伤害 1500，9 级提升到 2000；
 *   5 级消耗从 175 降到 150；9 级冷却从 55s 降到 48s。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：damage / cost / cooldown 都是 Model 中的 LevelScaledValue 阈值定义。
 */
test("Lv1–Lv9 伤害、消耗与冷却成长表", () => {
  assert.deepEqual(
    levelValues((level) => MagicPowderData.damage.getValueAt(level)),
    [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 2000],
  );
  assert.deepEqual(
    levelValues((level) => MagicPowderData.cost.getValueAt(level)),
    [175, 175, 175, 175, 150, 150, 150, 150, 150],
  );
  assert.deepEqual(
    levelValues((level) => MagicPowderData.cooldown.getValueAt(level)),
    [55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 48000],
  );
});
