import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob } from "../harness/sim.mjs";
import { TurtleZombieData } from "../../src/game/presets/monster/zombie/turtle_zombie.ts";

/**
 * 描述（TurtleZombie）：
 *   龟壳僵尸的龟壳 370 血、减伤 0.5；龟壳破碎后速度翻倍，
 *   且该加速只应用一次（buffApplied 防重复）。
 *
 * 验收路径：
 *   1) 检查龟壳 key / 血量 / damageScale。
 *   2) 100 伤害后龟壳减少 50。
 *   3) 700 伤害击碎龟壳，检查溢出 30、速度×2、buffApplied。
 *   4) 再次尝试吸收伤害应返回 false，速度不再变化。
 *
 * 预期结果：
 *   100→龟壳 320、本体 300；700→龟壳 0、本体 270、speed=original×2；
 *   破碎后 absorb 返回 false。
 *
 * 为什么：
 *   TURTLE_SHELL.maxHealth=370、damageScale=0.5；
 *   onHelmetBroken 在 buffApplied=false 时把 speed 设为 originalSpeed*2。
 */

test("龟壳 370 血、减伤 0.5", () => {
  resetSim();
  const { model, entity } = spawnMob(TurtleZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 14);
  assert.equal(model.helmetKey, "attach/turtle");
  assert.equal(model.helmetHealth, 370);
  assert.equal(model.helmetDef.damageScale, 0.5);

  model.absorbHelmetDamage(entity, 100);
  assert.equal(model.helmetHealth, 320);
  assert.equal(model.health, 300);
});

test("龟壳破碎后速度翻倍且只加速一次", () => {
  resetSim();
  const { model, entity } = spawnMob(TurtleZombieData, { col: 8, row: 2 });
  const originalSpeed = model.originalSpeed;
  model.absorbHelmetDamage(entity, 100);

  model.absorbHelmetDamage(entity, 700);
  assert.equal(model.helmetHealth, 0);
  assert.equal(model.helmetBroken, true);
  assert.equal(model.health, 270);
  assert.equal(model.buffApplied, true);
  assert.equal(model.speed, originalSpeed * 2);

  assert.equal(model.absorbHelmetDamage(entity, 100), false);
  assert.equal(model.speed, originalSpeed * 2);
});
