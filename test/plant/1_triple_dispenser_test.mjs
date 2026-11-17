import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, setSightTarget, ProjectileCmd, levelValues } from "../harness/sim.mjs";
import { TripleDispenserData } from "../../src/game/presets/plant/chapter1/triple_dispenser.ts";

/**
 * 描述（triple_dispenser_description）：
 *   向前方三路分别发射子弹；3 级中路变为 2 发；7 级三路都变为 2 发；
 *   星之碎片向前方扇形区域散射大量箭矢。
 *
 * 验收路径：
 *   1) 有目标时在 800ms 内触发一次普通齐射，按 model/targetRow 统计三路箭。
 *   2) 对比 Lv1/Lv3/Lv7 的齐射数量。
 *   3) 星碎后推进 3200ms，统计 MutantYAxisArrowModel 数量与单发伤害。
 *   4) 睡眠时不发射。
 *
 * 预期结果：
 *   Lv1 3 发（1/1/1），Lv3 4 发（1/2/1），Lv7 6 发（2/2/2）；
 *   星碎实际 59 轮 × 4 发 = 236 发，每发伤害 = 面板伤害/2。
 *
 * 为什么：
 *   shootArrows 按 LevelThresholds1=3、LevelThresholds2=7 增加中路/上下路箭；
 *   shootBruteVolley 每轮固定 2 个速度 × 上/下两个目标行 = 4 发；
 *   星碎为 delayedCall(200) + addEvent(repeat=58)，EntityTickManager 的
 *   repeat 表示总触发次数，因此是 1+58=59 轮（描述目标 60 轮，存在 1 轮偏差）。
 */

function volleyCalls() {
  return ProjectileCmd.calls.filter((call) => call.kind === "create");
}

test("Lv1 普通齐射为 1/1/1 共 3 发", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(TripleDispenserData, { level: 1, row: 2 });

  tick(sim, 800);
  const calls = volleyCalls();
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((call) => call.model === "ArrowModel").length, 1);
  assert.deepEqual(
    calls.filter((call) => call.model === "MutantYAxisArrowModel").map((call) => call.cfg.targetRow),
    [1, 3],
  );
  for (const call of calls) assert.equal(call.cfg.damage, 20);
});

test("Lv3 中路增加到 2 发，共 4 发", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(TripleDispenserData, { level: 3, row: 2 });

  tick(sim, 800);
  const calls = volleyCalls();
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((call) => call.model === "ArrowModel").length, 2);
});

test("Lv7 三路各 2 发，共 6 发", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(TripleDispenserData, { level: 7, row: 2 });

  tick(sim, 800);
  const calls = volleyCalls();
  assert.equal(calls.length, 6);
  assert.equal(calls.filter((call) => call.model === "ArrowModel").length, 2);
  const sideRows = calls
    .filter((call) => call.model === "MutantYAxisArrowModel")
    .map((call) => call.cfg.targetRow);
  assert.deepEqual(sideRows, [1, 1, 3, 3]);
});

test("星之碎片散射 236 发，单发伤害为面板一半", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { model, entity } = spawnPlant(TripleDispenserData, { level: 1, row: 2 });
  ProjectileCmd.reset();

  model.onStarShards(entity);
  tick(sim, 3_200);

  const calls = volleyCalls();
  assert.equal(calls.length, 236);
  assert.equal(calls.every((call) => call.model === "MutantYAxisArrowModel"), true);
  assert.equal(calls.every((call) => call.cfg.damage === 10), true);
  assert.equal(model.inBruteShoot, false);
});

test("睡眠时不发射", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { model } = spawnPlant(TripleDispenserData, { level: 1, row: 2 });
  model.isSleeping = true;

  tick(sim, 2_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   普通齐射数量：1–2 级 3 发，3–6 级 4 发，7–9 级 6 发；
 *   单发伤害按 1.35 的对数曲线成长。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：shootArrows 使用 LevelThresholds1=3、LevelThresholds2=7，
 *   damage 是 LevelScaledValue(20).setIncRatio(1.35)。
 */
test("Lv1–Lv9 齐射数量与伤害成长表", () => {
  assert.deepEqual(
    levelValues((level) => TripleDispenserData.damage.getValueAt(level)),
    [20, 22.208, 23.5, 24.417, 25.127, 25.708, 26.199, 26.625, 27],
  );
  const expectedVolley = [3, 3, 4, 4, 4, 4, 6, 6, 6];
  for (let level = 1; level <= 9; level++) {
    const sim = resetSim();
    setSightTarget(true);
    spawnPlant(TripleDispenserData, { level, row: 2 });
    tick(sim, 800);
    assert.equal(volleyCalls().length, expectedVolley[level - 1]);
  }
});

/**
 * 逐级星碎验收（Lv1–Lv9）：
 *   星之碎片固定 59 轮 × 4 发 = 236 发，单发伤害为该等级面板伤害的一半。
 * 预期结果：每一级都是 236 发，且单发伤害等于 damage/2。
 * 为什么：shootBruteVolley 使用 damage.getValueAt(level) / 2。
 */
test("Lv1–Lv9 星之碎片单发伤害表", () => {
  const expectedDamage = [10, 11.104, 11.75, 12.2085, 12.5635, 12.854, 13.0995, 13.3125, 13.5];
  for (let level = 1; level <= 9; level++) {
    const sim = resetSim();
    const { model, entity } = spawnPlant(TripleDispenserData, { level, row: 2 });
    ProjectileCmd.reset();
    model.onStarShards(entity);
    tick(sim, 3_200);

    const calls = volleyCalls();
    assert.equal(calls.length, 236);
    assert.equal(calls.every((call) => call.cfg.damage === expectedDamage[level - 1]), true);
  }
});
