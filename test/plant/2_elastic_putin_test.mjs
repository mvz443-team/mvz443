import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnPlant, tick, ProjectileCmd, levelValues } from "../harness/sim.mjs";
import { ElasticPutinData } from "../../src/game/presets/plant/chapter2/elastic_putin.ts";

/**
 * 描述（elastic_putin_description）：
 *   弹性小兵是被动单位，不主动攻击；会反弹己方箭矢、火箭等可反弹子弹；
 *   睡眠时无法反弹。星之碎片唤醒自身并激活闪电增强窗口，7 级窗口从
 *   5s 提升到 8s；闪电期间反弹的箭会获得闪电附魔并造成小范围爆炸。
 *
 * 验收路径：
 *   1) 直接调用真实 onStarShards，检查 isSleeping / isLightning。
 *   2) 推进 5s/8s 检查闪电窗口关闭时刻。
 *   3) 检查 canExtendSightLineFor 的阵营、睡眠、血量条件。
 *   4) 用可观测的子弹替身调用 Model 的反弹入口，覆盖阵营、可反弹标记、
 *      睡眠、闪电附魔，以及无 catchEnhancement 的火箭。
 *   5) 被动单位 5s 内不产生投射物。
 *
 * 预期结果：
 *   Lv1 星碎后 isLightning=true，5000ms 后为 false；
 *   Lv7 5000ms 时仍为 true，8000ms 后为 false；
 *   只有同阵营、清醒、血量 > 0 时 canExtendSightLineFor 返回 true；
 *   同阵营可反弹子弹在清醒时被反转速度，闪电窗口内追加 lightning，
 *   睡眠、敌阵营或 bounceable=false 时保持不变。
 *
 * 为什么：
 *   onStarShards 先 setSleeping(false)，再按 level>=7 选择 8000/5000；
 *   Model.onCollision 统一判断睡眠、阵营、bounceable 与闪电状态；
 *   activateLightning 用 tickmanager.delayedCall 关闭 isLightning；
 *   canExtendSightLineFor 的条件是 health>0 && !isSleeping && 阵营为 PLANT。
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

  assert.equal(model.canExtendSightLineFor(faction), true);
  model.isSleeping = true;
  assert.equal(model.canExtendSightLineFor(faction), false);
  model.isSleeping = false;
  assert.equal(model.canExtendSightLineFor(faction + 1), false);
  model.health = 0;
  assert.equal(model.canExtendSightLineFor(faction), false);
});

test("只反弹己方清醒状态下的可反弹子弹", () => {
  resetSim();
  const { model, entity } = spawnPlant(ElasticPutinData, { level: 1 });

  const makeProjectile = (overrides = {}) => {
    const projectile = {
      faction: entity.faction,
      bounceable: true,
      reversed: 0,
      enhancements: [],
      reverseVelocityX() { projectile.reversed += 1; },
      catchEnhancement(value) { projectile.enhancements.push(value); },
      ...overrides,
    };
    return projectile;
  };

  const friendly = makeProjectile();
  assert.equal(model.onCollision(entity, friendly), true);
  assert.equal(friendly.reversed, 1);
  assert.deepEqual(friendly.enhancements, []);

  model.isSleeping = true;
  assert.equal(model.onCollision(entity, friendly), false);
  assert.equal(friendly.reversed, 1);
  model.isSleeping = false;

  const enemy = makeProjectile({ faction: entity.faction + 1 });
  assert.equal(model.onCollision(entity, enemy), false);
  assert.equal(enemy.reversed, 0);

  const notBounceable = makeProjectile({ bounceable: false });
  assert.equal(model.onCollision(entity, notBounceable), false);
  assert.equal(notBounceable.reversed, 0);

  // 火箭没有 catchEnhancement，但仍应被反弹。
  const rocket = makeProjectile();
  delete rocket.catchEnhancement;
  assert.equal(model.onCollision(entity, rocket), true);
  assert.equal(rocket.reversed, 1);
});

test("闪电窗口内反弹的箭获得 lightning 附魔", () => {
  resetSim();
  const { model, entity } = spawnPlant(ElasticPutinData, { level: 1 });
  const projectile = {
    faction: entity.faction,
    bounceable: true,
    reversed: 0,
    enhancements: [],
    reverseVelocityX() { projectile.reversed += 1; },
    catchEnhancement(value) { projectile.enhancements.push(value); },
  };

  model.onStarShards(entity);
  assert.equal(model.onCollision(entity, projectile), true);
  assert.equal(projectile.reversed, 1);
  assert.deepEqual(projectile.enhancements, ["lightning"]);
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
