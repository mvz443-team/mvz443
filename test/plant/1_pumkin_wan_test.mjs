import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  spawnPlantViaData,
  tick,
  setSightTarget,
  getPlantsMap,
  ProjectileCmd,
  PlantCmd,
  PositionManager,
  levelValues,
} from "../harness/sim.mjs";
import { PumpkinWanData } from "../../src/game/presets/plant/chapter1/pumkin_wan.ts";
import { PumpkinData } from "../../src/game/presets/plant/chapter1/pumkin.ts";

/**
 * 描述（pumpkin_wan_description）：
 *   南瓜头·晚上每 500ms 对前方三行发射短促激光，5 级起可打飞行；
 *   9 级激光距离和起始偏移增加；星之碎片连续释放 5 次范围爆炸。
 *
 * 验收路径：
 *   1) 有目标时推进 1s，统计三行激光数量、伤害、distance、起始 x。
 *   2) 对比 Lv1/Lv9 的 distance、startOffset 和 couldAttackFlying。
 *   3) 星碎后按时间推进，统计 ProjectileCmd 爆炸次数与配置。
 *   4) 同格放入睡眠的基础南瓜，验证 createEntity 继承睡眠并销毁基座。
 *
 * 预期结果：
 *   Lv1 1s 内 2 轮 × 3 行，伤害 22.581，distance 3，起点 x-1.5 格；
 *   Lv9 distance 5、起点 x-2.5 格、可打飞行，伤害 30.484；
 *   星碎实际 4 次爆炸（描述 5 次），每次伤害 275、左右 1.5 格、上 1 行。
 *
 * 为什么：
 *   addEvent(startAt=250, delay=500) 首次在 250ms，之后每 500ms；
 *   getPulseDamage = heavy_laser 70 × 500 / 1550；
 *   bruteShot 用 repeat=4，EntityTickManager 中 repeat 表示总触发次数，
 *   因此实际 4 次；首次触发为 delay-startAt=200ms，而不是 1800ms。
 */

test("Lv1 1s 内两轮三行激光，伤害 22.581", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { entity } = spawnPlant(PumpkinWanData, { level: 1, row: 2 });

  tick(sim, 1_000);

  const lasers = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  assert.equal(lasers.length, 6);
  assert.deepEqual(lasers.map((call) => call.row), [1, 2, 3, 1, 2, 3]);
  for (const laser of lasers) {
    assert.equal(laser.cfg.damage, 22.581);
    assert.equal(laser.cfg.distance, 3);
    assert.equal(laser.cfg.couldAttackFlying, false);
    assert.equal(laser.x, entity.x - PositionManager.Instance.GRID_SIZEX * 1.5);
  }
});

test("Lv9 激光距离 5、偏移 2.5 格并可打飞行", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { entity } = spawnPlant(PumpkinWanData, { level: 9, row: 2 });

  tick(sim, 300);
  const lasers = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  assert.equal(lasers.length, 3);
  for (const laser of lasers) {
    assert.equal(laser.cfg.damage, 30.484);
    assert.equal(laser.cfg.distance, 5);
    assert.equal(laser.cfg.couldAttackFlying, true);
    assert.equal(laser.x, entity.x - PositionManager.Instance.GRID_SIZEX * 2.5);
  }
});

test("Lv5 起可攻击飞行单位", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(PumpkinWanData, { level: 5, row: 2 });

  tick(sim, 300);
  const lasers = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  assert.equal(lasers[0].cfg.couldAttackFlying, true);
});

test("星之碎片连续 4 次范围爆炸", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(PumpkinWanData, { level: 1, row: 2 });
  ProjectileCmd.reset();

  model.onStarShards(entity);
  tick(sim, 200);
  assert.equal(ProjectileCmd.calls.length, 1);

  tick(sim, 6_000);
  assert.equal(ProjectileCmd.calls.length, 4);
  for (const call of ProjectileCmd.calls) {
    assert.equal(call.kind, "explosion");
    assert.equal(call.cfg.damage, 275);
    assert.equal(call.cfg.upGrid, 1);
    assert.equal(call.cfg.leftGrid, 1.5);
    assert.equal(call.cfg.rightGrid, 1.5);
  }
});

test("替换同格基础南瓜并继承其睡眠状态", () => {
  resetSim();
  const base = spawnPlant(PumpkinData, { level: 1, col: 4, row: 2 });
  base.model.isSleeping = true;
  getPlantsMap().set("4-2", [base.entity]);

  const { model } = spawnPlantViaData(PumpkinWanData, { level: 1, col: 4, row: 2 });

  assert.equal(base.entity.destroyed, true);
  assert.equal(model.isSleeping, true);
  assert.equal(PlantCmd.calls.some((call) => call.kind === "sleeping" && call.value === true), true);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   面板伤害按 1.35 成长，500ms 脉冲伤害 = 面板伤害 × 500 / 1550；
 *   1–8 级激光距离 3 格、起点偏移 1.5 格，9 级变为 5 格与 2.5 格。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：damage / attackDistance / startOffset 是 Model 定义，
 *   getPulseDamage 是 Model 内的 DPS 换算公式。
 */
test("Lv1–Lv9 激光伤害、距离与偏移成长表", () => {
  assert.deepEqual(
    levelValues((level) => PumpkinWanData.damage.getValueAt(level)),
    [70, 77.729, 82.25, 85.458, 87.946, 89.979, 91.698, 93.187, 94.5],
  );
  assert.deepEqual(
    levelValues((level) => PumpkinWanData.getPulseDamage(
      level,
      PumpkinWanData.baseAttackInterval.getValueAt(level),
    )),
    [22.581, 25.074, 26.532, 27.567, 28.37, 29.025, 29.58, 30.06, 30.484],
  );
  assert.deepEqual(
    levelValues((level) => PumpkinWanData.attackDistance.getValueAt(level)),
    [3, 3, 3, 3, 3, 3, 3, 3, 5],
  );
  assert.deepEqual(
    levelValues((level) => PumpkinWanData.startOffset.getValueAt(level)),
    [1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 2.5],
  );
});
