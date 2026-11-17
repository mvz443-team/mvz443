import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, PlantCmd, levelValues } from "../harness/sim.mjs";
import { ObsidianData } from "../../src/game/presets/plant/chapter1/obsidian.ts";

/**
 * 描述（obsidian_description）：
 *   黑曜石有 4000 基础血量与 6000 护盾；护盾优先吸收伤害，9 级护盾受到 0.8 倍伤害；
 *   星之碎片恢复满护盾并回满血量。
 *
 * 验收路径：
 *   直接调用真实 onStarShards / onHurt，避免依赖物理碰撞。
 *
 * 预期结果：
 *   星碎后 shieldHealth = 6000、health = maxHealth；
 *   1000 伤害后 Lv1 护盾剩 5000，Lv9 护盾剩 5200；
 *   护盾不足时剩余伤害写入血量。
 *
 * 为什么：
 *   maxShieldHealth = 6000；onHurt 用 shieldRatio = level >= 9 ? 0.8 : 1.0，
 *   先扣护盾，护盾不足时 PlantCmd.SetHealth 扣剩余血量。
 */

test("星之碎片回满护盾和血量", () => {
  resetSim();
  const { model, entity } = spawnPlant(ObsidianData, { level: 1 });
  model.health = 100;

  model.onStarShards(entity);

  assert.equal(model.shieldHealth, 6000);
  assert.equal(model.health, model.healthMax);
  assert.equal(model.healthMax, 4000);
});

test("Lv1 护盾按 1:1 吸收伤害", () => {
  resetSim();
  const { model, entity } = spawnPlant(ObsidianData, { level: 1 });
  model.onStarShards(entity);
  const healthBefore = model.health;

  model.onHurt(entity, 1000, 1000);

  assert.equal(model.shieldHealth, 5000);
  assert.equal(model.health, healthBefore);
});

test("Lv9 护盾按 0.8 倍吸收伤害", () => {
  resetSim();
  const { model, entity } = spawnPlant(ObsidianData, { level: 9 });
  model.onStarShards(entity);

  model.onHurt(entity, 1000, 1000);
  assert.equal(model.shieldHealth, 5200);
});

test("护盾不足时剩余伤害写入血量", () => {
  resetSim();
  const { model, entity } = spawnPlant(ObsidianData, { level: 1 });
  model.shieldHealth = 500;
  const healthBefore = model.health;

  model.onHurt(entity, 1000, 1000);

  assert.equal(model.shieldHealth, 0);
  assert.equal(model.health, healthBefore - 500);
  assert.equal(PlantCmd.calls.at(-1).kind, "health");
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   基础血量按 1.4 的对数曲线成长；5 级冷却从 32s 降到 24s；
 *   1000 点伤害后，1–8 级护盾剩 5000，9 级因 0.8 倍吸收剩 5200。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：maxHealth / cooldown 是 LevelScaledValue，护盾倍率由 onHurt 的 level>=9 分支决定。
 */
test("Lv1–Lv9 血量、冷却与护盾吸收表", () => {
  assert.deepEqual(
    levelValues((level) => ObsidianData.maxHealth.getValueAt(level)),
    [4000, 4504.744, 4800, 5009.488, 5171.979, 5304.744, 5416.995, 5514.231, 5600],
  );
  assert.deepEqual(
    levelValues((level) => ObsidianData.cooldown.getValueAt(level)),
    [32000, 32000, 32000, 32000, 24000, 24000, 24000, 24000, 24000],
  );

  const expectedShield = [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5200];
  for (let level = 1; level <= 9; level++) {
    resetSim();
    const { model, entity } = spawnPlant(ObsidianData, { level });
    model.onStarShards(entity);
    model.onHurt(entity, 1000, 1000);
    assert.equal(model.shieldHealth, expectedShield[level - 1]);
  }
});
