import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, tick } from "../harness/sim.mjs";
import { TurtleZombieData } from "../../src/game/presets/monster/zombie/turtle_zombie.ts";

/**
 * 描述（TurtleZombie）：
 *   龟壳僵尸的龟壳 370 血、减伤 0.5；龟壳破碎后获得一次性 berserk（900s），
 *   速度/攻速/动画倍率由 buff 系统统一处理，且只应用一次（buffApplied 防重复）。
 *
 * 验收路径：
 *   1) 检查龟壳 key / 血量 / damageScale。
 *   2) 100 伤害后龟壳减少 50。
 *   3) 700 伤害击碎龟壳，检查溢出 30、hasBuff('berserk')、speedMultiplier=2。
 *   4) 再次尝试吸收伤害应返回 false，buff 不叠加。
 *
 * 预期结果：
 *   100→龟壳 320、本体 300；700→龟壳 0、本体 270、speed 字段保持 originalSpeed；
 *   hasBuff('berserk')=true、speedMultiplier=2、attackIntervalMultiplier=0.5。
 *
 * 为什么：
 *   TURTLE_SHELL.maxHealth=370、damageScale=0.5；
 *   onHeadBroken 调 applyBuff('berserk', 900000)，倍率是派生 getter 不改 speed 字段。
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

test("龟壳破碎后获得 900s berserk 且只应用一次", () => {
  resetSim();
  const { model, entity } = spawnMob(TurtleZombieData, { col: 8, row: 2 });
  const originalSpeed = model.originalSpeed;
  model.absorbHelmetDamage(entity, 100);

  model.absorbHelmetDamage(entity, 700);
  assert.equal(model.helmetHealth, 0);
  assert.equal(model.helmetBroken, true);
  assert.equal(model.health, 270);
  assert.equal(model.buffApplied, true);

  // speed 字段本身不变；加速通过倍率体现（900s 有界，非永久）。
  assert.equal(model.speed, originalSpeed);
  assert.equal(model.hasBuff("berserk"), true);
  assert.equal(model.speedMultiplier, 2);
  assert.equal(model.attackIntervalMultiplier, 0.5);
  assert.ok(model.getBuffLeftMs("berserk") > 0 && model.getBuffLeftMs("berserk") <= 900_000);

  assert.equal(model.absorbHelmetDamage(entity, 100), false);
  assert.equal(model.speedMultiplier, 2);
});
