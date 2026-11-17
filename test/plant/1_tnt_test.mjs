import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, ProjectileCmd, levelValues } from "../harness/sim.mjs";
import { TntData } from "../../src/game/presets/plant/chapter1/tnt.ts";

/**
 * 描述（tnt_description）：
 *   TNT 落地后短延迟爆炸，对 1.5 格范围造成高额伤害；5 级起伤害额外 ×1.3；
 *   7 级起爆炸后原地留下集束炸弹，3 秒后再次爆炸；TNT 无法使用星之碎片。
 *
 * 验收路径：
 *   1) 创建后 800ms 不应爆炸，850ms 应产生一次爆炸，900ms 自身销毁。
 *   2) 检查爆炸配置 damage / rightGrid / leftGrid / upGrid。
 *   3) 对比 Lv1 与 Lv5 的 explosionDamage。
 *   4) 调用 onStarShards 不应产生任何投射物。
 *
 * 预期结果：
 *   Lv1 伤害 1400；Lv5 为 1758.919×1.3=2286.595；
 *   爆炸 right/left 1.5 格、up 1 行；Lv7 在 850ms 与 3850ms 各爆炸一次；
 *   星碎无效果。
 *
 * 为什么：
 *   onCreate 用 tickmanager.delayedCall(850/900) 驱动；
 *   damage = LevelScaledValue(1400).setIncRatio(1.35)，5 级再乘 1.3；
 *   primaryExplosion 固定 rightGrid=1.5、leftGrid=1.5、upGrid=1。
 */

test("850ms 爆炸、900ms 销毁，Lv1 伤害 1400", () => {
  const sim = resetSim();
  const { entity } = spawnPlant(TntData, { level: 1, row: 2 });

  tick(sim, 800);
  assert.equal(ProjectileCmd.calls.length, 0);
  assert.equal(entity.destroyed, undefined);

  tick(sim, 50);
  assert.equal(ProjectileCmd.calls.length, 1);
  const explosion = ProjectileCmd.calls[0];
  assert.equal(explosion.kind, "explosion");
  assert.equal(explosion.cfg.damage, 1400);
  assert.equal(explosion.cfg.rightGrid, 1.5);
  assert.equal(explosion.cfg.leftGrid, 1.5);
  assert.equal(explosion.cfg.upGrid, 1);

  tick(sim, 50);
  assert.equal(entity.destroyed, true);
});

test("Lv5 爆炸伤害额外 ×1.3", () => {
  const sim = resetSim();
  spawnPlant(TntData, { level: 5, row: 2 });

  tick(sim, 850);
  assert.equal(ProjectileCmd.calls.length, 1);
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 2286.5947);
});

test("Lv7 集束炸弹在 3 秒后再次爆炸", () => {
  const sim = resetSim();
  const { entity } = spawnPlant(TntData, { level: 7, row: 2 });

  tick(sim, 850);
  assert.equal(ProjectileCmd.calls.length, 1);
  assert.equal(entity.destroyed, undefined);

  tick(sim, 2_950);
  assert.equal(ProjectileCmd.calls.length, 1);
  tick(sim, 50);
  assert.equal(ProjectileCmd.calls.length, 2);
  assert.equal(ProjectileCmd.calls[1].cfg.damage, 2384.1415);
  assert.equal(entity.destroyed, true);
});

test("星之碎片对 TNT 没有效果", () => {
  resetSim();
  const { model, entity } = spawnPlant(TntData, { level: 1, row: 2 });
  ProjectileCmd.reset();

  model.onStarShards(entity);
  assert.equal(ProjectileCmd.calls.length, 0);
});

test("睡眠不影响 TNT 的倒计时爆炸", () => {
  const sim = resetSim();
  const { model } = spawnPlant(TntData, { level: 1, row: 2 });
  model.isSleeping = true;

  tick(sim, 850);
  assert.equal(ProjectileCmd.calls.length, 1);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   爆炸伤害按 1.35 成长，5 级起再额外 ×1.3；
 *   冷却按 0.85 的对数曲线从 50s 缩短到 42.5s。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：onCreate 先取 damage.getValueAt(level)，再在 level>=5 时乘 1.3。
 */
test("Lv1–Lv9 爆炸伤害与冷却成长表", () => {
  const expectedExplosion = [
    1400, 1554.578, 1645, 1709.156, 2286.5947, 2339.4514, 2384.1415, 2422.8529, 2457,
  ];
  assert.deepEqual(
    levelValues((level) => TntData.damage.getValueAt(level)),
    [1400, 1554.578, 1645, 1709.156, 1758.919, 1799.578, 1833.955, 1863.733, 1890],
  );
  assert.deepEqual(
    levelValues((level) => TntData.cooldown.getValueAt(level)),
    [50000, 47634.013, 46250, 45268.027, 44506.349, 43884.013, 43357.836, 42902.04, 42500],
  );

  for (let level = 1; level <= 9; level++) {
    const sim = resetSim();
    spawnPlant(TntData, { level, row: 2 });
    tick(sim, 850);
    assert.equal(ProjectileCmd.calls[0].cfg.damage, expectedExplosion[level - 1]);
  }
});
