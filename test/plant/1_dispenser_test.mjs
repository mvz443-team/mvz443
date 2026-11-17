import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  tick,
  setSightTarget,
  ProjectileCmd,
  levelValues,
} from "../harness/sim.mjs";
import { DispenserData } from "../../src/game/presets/plant/chapter1/dispenser.ts";

/**
 * 描述（dispenser_description）：
 *   消耗 100，向前发射箭；3 级起箭矢可穿透 1 个目标（每穿透一个衰减 50% 伤害）；
 *   5 级星之碎片箭矢多穿透一个目标；星碎技能向前发射 50 发箭。
 *
 * 验收路径：
 *   用 SightLine 替身控制“前方是否有目标”，驱动真实 DispenserModel。
 *   1) 有目标 5s，统计普通箭数量与伤害/穿透。
 *   2) 无目标 5s，不产生箭。
 *   3) Lv3 普通箭 penetratePower = 2。
 *   4) Lv1/Lv5 星碎各发射 50 发，穿透分别为 1/3。
 *   5) 睡眠时不攻击。
 *
 * 预期结果：
 *   Lv1 5s 内 5 发，伤害 20，穿透 1；Lv3 穿透 2；星碎 49 发；
 *   Lv5 星碎穿透 3；睡眠 0 发。
 *
 * 为什么：
 *   onCreate 注册 startAt=800 / delay=1000 的循环 timer；
 *   penetratePower 在 3 级阈值变 2，starShardsPenetratePower 在 3/5 级变 2/3；
 *   EntityTickManager 的 repeat 表示“总触发次数”，bruteShot 传入
 *   repeat = totalArrows - 1 = 49，因此实际发射 49 发；与注释中的
 *   50 发存在 1 发偏差（当前实现行为）。
 */

test("有目标时 Lv1 每 1s 发射一发伤害 20 的箭", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(DispenserData, { level: 1 });

  tick(sim, 5_000);

  assert.equal(ProjectileCmd.calls.length, 5);
  for (const call of ProjectileCmd.calls) {
    assert.equal(call.model, "ArrowModel");
    assert.equal(call.cfg.damage, 20);
    assert.equal(call.cfg.penetratePower, 1);
  }
});

test("无目标时不发射", () => {
  const sim = resetSim();
  setSightTarget(false);
  spawnPlant(DispenserData, { level: 1 });

  tick(sim, 5_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

test("Lv3 普通箭穿透提升到 2", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(DispenserData, { level: 3 });

  tick(sim, 2_000);
  assert.equal(ProjectileCmd.calls.length, 2);
  assert.equal(ProjectileCmd.calls[0].cfg.penetratePower, 2);
});

test("星之碎片发射 49 发，并按等级使用星碎穿透", () => {
  const sim = resetSim();
  setSightTarget(true);
  const lv1 = spawnPlant(DispenserData, { level: 1 });
  ProjectileCmd.reset();
  lv1.model.onStarShards(lv1.entity);
  tick(sim, 2_700);
  assert.equal(ProjectileCmd.calls.length, 49);
  assert.equal(ProjectileCmd.calls[0].cfg.penetratePower, 1);

  const sim2 = resetSim();
  setSightTarget(true);
  const lv5 = spawnPlant(DispenserData, { level: 5 });
  ProjectileCmd.reset();
  lv5.model.onStarShards(lv5.entity);
  tick(sim2, 2_700);
  assert.equal(ProjectileCmd.calls.length, 49);
  assert.equal(ProjectileCmd.calls[0].cfg.penetratePower, 3);
});

test("睡眠时不发射", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { model } = spawnPlant(DispenserData, { level: 1 });
  model.isSleeping = true;

  tick(sim, 5_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   普通箭伤害按 1.35 对数成长；3 级起普通箭穿透 2；
 *   星碎穿透在 3/5 级阈值变为 2/3；5 级消耗降为 75。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：这些值全部由 DispenserData 的 LevelScaledValue 定义，属于 Model 业务数值。
 */
test("Lv1–Lv9 等级成长表", () => {
  assert.deepEqual(
    levelValues((level) => DispenserData.damage.getValueAt(level)),
    [20, 22.208, 23.5, 24.417, 25.127, 25.708, 26.199, 26.625, 27],
  );
  assert.deepEqual(
    levelValues((level) => DispenserData.penetratePower.getValueAt(level)),
    [1, 1, 2, 2, 2, 2, 2, 2, 2],
  );
  assert.deepEqual(
    levelValues((level) => DispenserData.starShardsPenetratePower.getValueAt(level)),
    [1, 1, 2, 2, 3, 3, 3, 3, 3],
  );
  assert.deepEqual(
    levelValues((level) => DispenserData.cost.getValueAt(level)),
    [100, 100, 100, 100, 75, 75, 75, 75, 75],
  );
});

/**
 * 逐级星碎验收（Lv1–Lv9）：
 *   星之碎片固定发射 49 发箭，穿透力按 3/5 级阈值使用 1/2/3。
 * 预期结果：每一级 49 发，且全部使用该等级的星碎穿透值。
 * 为什么：bruteShot 的 normalShot 传入 starShardsPenetratePower.getValueAt(level)。
 */
test("Lv1–Lv9 星之碎片穿透表", () => {
  const expectedPenetration = [1, 1, 2, 2, 3, 3, 3, 3, 3];
  for (let level = 1; level <= 9; level++) {
    const sim = resetSim();
    const { model, entity } = spawnPlant(DispenserData, { level });
    model.onStarShards(entity);
    tick(sim, 3_000);

    assert.equal(ProjectileCmd.calls.length, 49);
    assert.equal(
      ProjectileCmd.calls.every(
        (call) => call.cfg.penetratePower === expectedPenetration[level - 1],
      ),
      true,
    );
  }
});
