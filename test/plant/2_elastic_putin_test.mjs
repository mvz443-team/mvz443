import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, ProjectileCmd, levelValues } from "../harness/sim.mjs";
import { ElasticPutinData } from "../../src/game/presets/plant/chapter2/elastic_putin.ts";

/**
 * 描述（elastic_putin_description）：
 *   弹性小兵是被动单位，不主动攻击；星之碎片唤醒自身并激活闪电增强窗口，
 *   7 级窗口从 5s 提升到 8s；闪电期间反弹的箭会获得闪电附魔。
 *
 * 验收路径：
 *   1) 直接调用真实 onStarShards，检查 isSleeping / isLightning。
 *   2) 推进 5s/8s 检查闪电窗口关闭时刻。
 *   3) 检查 canExtendSightLineFor 的阵营、睡眠、血量条件。
 *   4) 被动单位 5s 内不产生投射物。
 *
 * 预期结果：
 *   Lv1 星碎后 isLightning=true，5000ms 后为 false；
 *   Lv7 5000ms 时仍为 true，8000ms 后为 false；
 *   只有同阵营、清醒、血量 > 0 时 canExtendSightLineFor 返回 true。
 *
 * 为什么：
 *   onStarShards 先 setSleeping(false)，再按 level>=7 选择 8000/5000；
 *   activateLightning 用 tickmanager.delayedCall 关闭 isLightning；
 *   canExtendSightLineFor 的条件是 currentHealth>0 && !isSleeping && faction 相同。
 */

test("Lv1 星碎唤醒并激活 5s 闪电", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(ElasticPutinData, { level: 1 });
  model.isSleeping = true;

  model.onStarShards(entity);
  assert.equal(model.isSleeping, false);
  assert.equal(model.isLightning, true);

  tick(sim, 4_950);
  assert.equal(model.isLightning, true);
  tick(sim, 100);
  assert.equal(model.isLightning, false);
});

test("Lv7 闪电窗口延长到 8s", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(ElasticPutinData, { level: 7 });

  model.onStarShards(entity);
  tick(sim, 5_000);
  assert.equal(model.isLightning, true);
  tick(sim, 3_000);
  assert.equal(model.isLightning, false);
});

test("canExtendSightLineFor 受阵营、睡眠和血量限制", () => {
  resetSim();
  const { model, entity } = spawnPlant(ElasticPutinData, { level: 1 });
  const faction = entity.faction;

  assert.equal(entity.canExtendSightLineFor(faction), true);
  model.isSleeping = true;
  assert.equal(entity.canExtendSightLineFor(faction), false);
  model.isSleeping = false;
  assert.equal(entity.canExtendSightLineFor(faction + 1), false);
  model.health = 0;
  assert.equal(entity.canExtendSightLineFor(faction), false);
});

test("被动单位不会主动发射投射物", () => {
  const sim = resetSim();
  spawnPlant(ElasticPutinData, { level: 1 });

  tick(sim, 5_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   3 级消耗从 100 降到 75；闪电窗口 1–6 级 5s，7–9 级 8s。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：cost 是 LevelScaledValue(100).setThreshold(3, 75)，
 *   onStarShards 用 level>=7 选择 8000/5000ms。
 */
test("Lv1–Lv9 消耗与闪电窗口表", () => {
  assert.deepEqual(
    levelValues((level) => ElasticPutinData.cost.getValueAt(level)),
    [100, 100, 75, 75, 75, 75, 75, 75, 75],
  );

  const durations = [5000, 5000, 5000, 5000, 5000, 5000, 8000, 8000, 8000];
  for (let level = 1; level <= 9; level++) {
    const sim = resetSim();
    const { model, entity } = spawnPlant(ElasticPutinData, { level });
    model.onStarShards(entity);
    assert.equal(model.isLightning, true);
    tick(sim, durations[level - 1] - 100);
    assert.equal(model.isLightning, true);
    tick(sim, 100);
    assert.equal(model.isLightning, false);
  }
});
