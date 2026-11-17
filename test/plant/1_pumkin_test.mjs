import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, setSightTarget, ProjectileCmd, levelValues } from "../harness/sim.mjs";
import { PumpkinData } from "../../src/game/presets/plant/chapter1/pumkin.ts";

/**
 * 描述（pumpkin_description）：
 *   南瓜头是夜间激光植物；周期 1950ms 随等级缩短，对前方 4.6 格发射 42 基础伤害激光；
 *   9 级激光附加 3s 减速；星之碎片向上中下三行发射 290 基础伤害的大招激光。
 *
 * 验收路径：
 *   SightLine 替身控制目标，驱动真实 PumpkinModel。
 *
 * 预期结果：
 *   Lv1 5s 内 3 条普通激光，伤害 42；Lv9 2s 内 2 条且带 slow/3000ms；
 *   星碎 3 条激光，伤害 290，distance 12；睡眠 0 条。
 *
 * 为什么：
 *   addEvent 的 startAt 是“提前量”：首次触发 = delay - startAt，
 *   因此 Lv1 首次约 487.5ms，之后每 1950ms 一次，5s 内 3 次；
 *   Lv9 攻击间隔降到 1462.5ms，2s 内 2 次；
 *   Lv9 在 normalShot 中写入 debuff='slow'、debuffDuration=3000；
 *   masterSpark 遍历 row-1..row+1，distance=12。
 */

test("Lv1 普通激光 5s 内发射 3 次，伤害 42", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(PumpkinData, { level: 1, row: 2 });

  tick(sim, 5_000);

  assert.equal(ProjectileCmd.calls.length, 3);
  for (const call of ProjectileCmd.calls) {
    assert.equal(call.kind, "laser");
    assert.equal(call.cfg.damage, 42);
    assert.equal(call.cfg.distance, 4.6);
  }
});

test("Lv9 普通激光附加 3s 减速", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(PumpkinData, { level: 9, row: 2 });

  tick(sim, 2_000);
  assert.equal(ProjectileCmd.calls.length, 2);
  assert.equal(ProjectileCmd.calls[0].cfg.debuff, "slow");
  assert.equal(ProjectileCmd.calls[0].cfg.debuffDuration, 3000);
});

test("星之碎片对三行发射大招激光", () => {
  resetSim();
  setSightTarget(true);
  const { model, entity } = spawnPlant(PumpkinData, { level: 1, row: 2 });
  ProjectileCmd.reset();

  model.onStarShards(entity);

  assert.equal(ProjectileCmd.calls.length, 3);
  assert.deepEqual(ProjectileCmd.calls.map((call) => call.row), [1, 2, 3]);
  for (const call of ProjectileCmd.calls) {
    assert.equal(call.cfg.damage, 290);
    assert.equal(call.cfg.distance, 12);
  }
});

test("睡眠时不发射普通激光", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { model } = spawnPlant(PumpkinData, { level: 1, row: 2 });
  model.isSleeping = true;

  tick(sim, 5_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   普通激光伤害按 1.35、大招伤害按 1.3 的对数曲线成长；
 *   攻击间隔从 1950ms 按 0.75 的对数曲线缩短到 1462.5ms。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：damage / SparkDamage / baseAttackInterval 都是 Model 中的 LevelScaledValue。
 */
test("Lv1–Lv9 伤害与攻击间隔成长表", () => {
  assert.deepEqual(
    levelValues((level) => PumpkinData.damage.getValueAt(level)),
    [42, 46.637, 49.35, 51.275, 52.768, 53.987, 55.019, 55.912, 56.7],
  );
  assert.deepEqual(
    levelValues((level) => PumpkinData.SparkDamage.getValueAt(level)),
    [290, 317.445, 333.5, 344.891, 353.726, 360.945, 367.049, 372.336, 377],
  );
  assert.deepEqual(
    levelValues((level) => PumpkinData.baseAttackInterval.getValueAt(level)),
    [1950, 1796.211, 1706.25, 1642.422, 1592.913, 1552.461, 1518.259, 1488.633, 1462.5],
  );
});

/**
 * 逐级星碎验收（Lv1–Lv9）：
 *   星之碎片固定向三行各发射 1 条大招激光，伤害使用该等级的 SparkDamage。
 * 预期结果：每一级 3 条激光，伤害等于对应等级的 SparkDamage。
 * 为什么：masterSpark 对 row-1..row+1 创建激光，damage 来自 SparkDamage.getValueAt(level)。
 */
test("Lv1–Lv9 星之碎片大招伤害表", () => {
  const expectedDamage = [290, 317.445, 333.5, 344.891, 353.726, 360.945, 367.049, 372.336, 377];
  for (let level = 1; level <= 9; level++) {
    resetSim();
    const { model, entity } = spawnPlant(PumpkinData, { level, row: 2 });
    model.onStarShards(entity);

    assert.equal(ProjectileCmd.calls.length, 3);
    assert.deepEqual(
      ProjectileCmd.calls.map((call) => call.cfg.damage),
      [expectedDamage[level - 1], expectedDamage[level - 1], expectedDamage[level - 1]],
    );
  }
});
