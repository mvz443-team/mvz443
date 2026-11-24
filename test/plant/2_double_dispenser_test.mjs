import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, setSightTarget, ProjectileCmd, levelValues } from "../harness/sim.mjs";
import { DoubleDispenserData } from "../../src/game/presets/plant/chapter2/double_dispenser.ts";

/**
 * 描述（double_dispenser_description）：
 *   双向发射器同时攻击前后方；1 级起后方就是 2 发；3 级后方再多 1 发；
 *   7 级前后方各再多 1 发；
 *   星之碎片向前方连射箭矢，并周期性向后方发射烟花火箭。
 *
 * 验收路径：
 *   1) 有目标时触发一次普通齐射，按 speed 正负区分前后方箭。
 *   2) 对比 Lv1/Lv3/Lv7 的箭矢数量。
 *   3) 星碎后推进 1800ms，统计前方 ArrowModel 与后方 HFireWorkModel。
 *   4) 睡眠时不发射。
 *
 * 预期结果：
 *   Lv1 齐射 3 发（前 1 后 2）；Lv3 4 发（前 1 后 3）；Lv7 6 发（前 2 后 4）；
 *   星碎 35 发前方箭（伤害 10）+ 5 发后方烟花（伤害 150、爆炸 100）。
 *
 * 为什么：
 *   普通齐射在 300ms 首次触发；后方基础第 2 发在 100ms 后必发，
 *   Lv3 在 200ms 后补第 3 发，Lv7 在 300ms 后补第 4 发；前方 Lv7 在 100ms
 *   后补第 2 发。星碎 addEvent(repeat=35) 共 35 轮，frontCount 每 7 发
 *   触发一次烟花（0/7/14/21/28）。星碎是独立技能，不享受 7 级普攻追加。
 */

function shots() {
  return ProjectileCmd.calls.filter((call) => call.kind === "create");
}

test("Lv1 普通齐射前 1 后 2", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(DoubleDispenserData, { level: 1, row: 2 });

  tick(sim, 700);
  const calls = shots();
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((call) => call.cfg.speed === undefined).length, 1);
  assert.equal(calls.filter((call) => call.cfg.speed < 0).length, 2);
  for (const call of calls) assert.equal(call.cfg.damage, 20);
});

test("Lv3 后方增加 1 发", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(DoubleDispenserData, { level: 3, row: 2 });

  tick(sim, 800);
  const calls = shots();
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((call) => call.cfg.speed === undefined).length, 1);
  assert.equal(calls.filter((call) => call.cfg.speed < 0).length, 3);
});

test("Lv7 前后方各增加 1 发", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(DoubleDispenserData, { level: 7, row: 2 });

  tick(sim, 900);
  const calls = shots();
  assert.equal(calls.length, 6);
  assert.equal(calls.filter((call) => call.cfg.speed === undefined).length, 2);
  assert.equal(calls.filter((call) => call.cfg.speed < 0).length, 4);
  for (const call of calls) assert.equal(call.cfg.damage, 25.314);
});

test("星之碎片 35 发前方箭 + 5 发后方烟花", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(DoubleDispenserData, { level: 1, row: 2 });
  ProjectileCmd.reset();

  model.onStarShards(entity);
  tick(sim, 1_800);

  const calls = shots();
  const arrows = calls.filter((call) => call.model === "ArrowModel" && call.cfg.speed === undefined);
  const fireworks = calls.filter((call) => call.model === "HFireWorkModel");
  assert.equal(arrows.length, 35);
  assert.equal(fireworks.length, 5);
  assert.equal(arrows.every((call) => call.cfg.damage === 10), true);
  for (const firework of fireworks) {
    assert.equal(firework.cfg.damage, 150);
    assert.equal(firework.cfg.explodeDamage, 100);
    assert.equal(firework.cfg.speed < 0, true);
  }
});

test("睡眠时不发射", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { model } = spawnPlant(DoubleDispenserData, { level: 1, row: 2 });
  model.isSleeping = true;

  tick(sim, 3_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   普通齐射数量：1–2 级 3 发（前 1 后 2），3–6 级 4 发（前 1 后 3），
 *   7–9 级 6 发（前 2 后 4）；
 *   普通箭伤害按 1.3、后方烟花伤害按 1.2 成长。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：shootBackArrow 基础即 2 发反向箭，3/7 级各再加 1 发反向箭；
 *   shootFrontArrow 在 7 级加 1 发；damage / fireworkDamage 是 LevelScaledValue。
 */
test("Lv1–Lv9 齐射数量与伤害成长表", () => {
  assert.deepEqual(
    levelValues((level) => DoubleDispenserData.damage.getValueAt(level)),
    [20, 21.893, 23, 23.786, 24.395, 24.893, 25.314, 25.678, 26],
  );
  assert.deepEqual(
    levelValues((level) => DoubleDispenserData.fireworkDamage.getValueAt(level)),
    [150, 159.464, 165, 168.928, 171.975, 174.464, 176.569, 178.392, 180],
  );
  const expectedVolley = [3, 3, 4, 4, 4, 4, 6, 6, 6];
  for (let level = 1; level <= 9; level++) {
    const sim = resetSim();
    setSightTarget(true);
    spawnPlant(DoubleDispenserData, { level, row: 2 });
    tick(sim, 1_000);
    assert.equal(shots().length, expectedVolley[level - 1]);
  }
});

/**
 * 逐级星碎验收（Lv1–Lv9）：
 *   星之碎片固定 35 轮前方箭（伤害 10）+ 5 发后方烟花；
 *   7 级追加只属于普通齐射，星碎不额外翻倍；
 *   烟花伤害使用该等级的 fireworkDamage。
 * 预期结果：每一级都是 35 箭与 5 发烟花。
 * 为什么：星碎调用 shootFrontArrow(..., false)，跳过 level>=7 的普通齐射追加；
 *   shootBackFirework 使用 fireworkDamage.getValueAt(level)。
 */
test("Lv1–Lv9 星之碎片烟花伤害表", () => {
  const expectedFirework = [150, 159.464, 165, 168.928, 171.975, 174.464, 176.569, 178.392, 180];
  for (let level = 1; level <= 9; level++) {
    const sim = resetSim();
    const { model, entity } = spawnPlant(DoubleDispenserData, { level, row: 2 });
    ProjectileCmd.reset();
    model.onStarShards(entity);
    tick(sim, 1_800);

    const calls = shots();
    const arrows = calls.filter((call) => call.model === "ArrowModel" && call.cfg.speed === undefined);
    const fireworks = calls.filter((call) => call.model === "HFireWorkModel");
    assert.equal(arrows.length, 35);
    assert.equal(fireworks.length, 5);
    assert.equal(arrows.every((call) => call.cfg.damage === 10), true);
    assert.equal(
      fireworks.every((call) => call.cfg.damage === expectedFirework[level - 1]),
      true,
    );
  }
});
