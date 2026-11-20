import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob } from "../harness/sim.mjs";
import { BalloonCapZombieData } from "../../src/game/presets/monster/zombie/chapter2/balloon_cap_zombie.ts";

/**
 * 描述（气球帽子僵尸）：
 *   与气球僵尸完全相同，只是飞行载具里装的是帽子僵尸：本体 300 血，
 *   额外一层 370 血的帽子护甲（阈值 250 / 125，皮革命中音效）。
 *   载具规则不变：bullet 被载具完全吸收，laser / explosion 穿透载具打到本体。
 *
 * 验收路径：
 *   1) spawnMob 后检查 vehicleHealth = 1、helmetKey = attach/cap、helmetHealth = 370。
 *   2) bullet 命中载具后检查帽子完好（370）。
 *   3) laser 命中载具后调用 absorbHelmetDamage，检查帽子掉血；
 *      超过帽子剩余血量时检查溢出伤害结算到本体。
 *
 * 预期结果：
 *   初始 flying = true、vehicleHealth = 1、helmetHealth = 370；
 *   bullet → 载具爆炸、helmetHealth 仍为 370、health 仍为 300；
 *   laser → 载具爆炸；帽子吸收 100 后为 270；
 *   400 伤害打帽子 → 帽子归零，溢出 30 结算到本体（health = 270）。
 *
 * 为什么：
 *   BalloonCapZombieModel 用 withHelmetModel 组合 FlyingMonsterModel，
 *   onCreate 里 equipHelmet(BALLOON_CAP_HELMET)；Entity 侧伤害路由固定为
 *   载具 → shield → helmet → 本体，所以两层血条互不影响。
 */

function source(hitKind) {
  return { model: { hitKind } };
}

test("初始状态：载具 + 帽子两层血条", () => {
  resetSim();
  const { model } = spawnMob(BalloonCapZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 20);
  assert.equal(model.vehicleHealth, 1);
  assert.equal(model.hasVehicle, true);
  assert.equal(model.flying, true);
  assert.equal(model.helmetKey, "attach/cap");
  assert.equal(model.helmetHealth, 370);
  assert.equal(model.helmetBroken, false);
  assert.equal(model.health, 300);
});

test("子弹只打爆气球，帽子与本体都不掉血", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonCapZombieData, { col: 8, row: 2 });

  assert.equal(model.absorbVehicleDamage(entity, 100, undefined, source("bullet")), true);
  assert.equal(model.vehicleBroken, true);
  assert.equal(model.flying, false);
  assert.equal(model.helmetHealth, 370);
  assert.equal(model.health, 300);
});

test("激光穿透载具后由帽子吸收", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonCapZombieData, { col: 8, row: 2 });

  assert.equal(model.absorbVehicleDamage(entity, 100, undefined, source("laser")), false);
  assert.equal(model.absorbHelmetDamage(entity, 100), true);

  assert.equal(model.helmetHealth, 270);
  assert.equal(model.health, 300);
});

test("帽子破碎后溢出伤害结算到本体", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonCapZombieData, { col: 8, row: 2 });

  model.absorbVehicleDamage(entity, 100, undefined, source("laser"));
  assert.equal(model.absorbHelmetDamage(entity, 400), true);

  assert.equal(model.helmetHealth, 0);
  assert.equal(model.helmetBroken, true);
  assert.equal(model.health, 270);
});
