import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob } from "../harness/sim.mjs";
import { CapZombieData } from "../../src/game/presets/monster/zombie/cap_zombie.ts";
import { VindicatorSoliderData } from "../../src/game/presets/monster/zombie/vindicator_solider.ts";
import { BoatZombieData } from "../../src/game/presets/monster/zombie/water/boat_zombie.ts";
import { DolphinRiderZombieData } from "../../src/game/presets/monster/zombie/water/dolphin_rider_zombie.ts";
import { MinerZombieData } from "../../src/game/presets/monster/zombie/miner_zombie.ts";
import { VindicatorData } from "../../src/game/presets/monster/zombie/vindicator.ts";
import { SkeletonBowData } from "../../src/game/presets/monster/zombie/skeleton_bow.ts";
import { DivingZombieData } from "../../src/game/presets/monster/zombie/water/diving_zombie.ts";
import { BalloonTntCloneData } from "../../src/game/presets/monster/summon/balloon_tnt_clone.ts";
import { ZombieEntity, ZombieModel } from "../../src/game/presets/monster/zombie/zombie.ts";

function source(hitKind, vx) {
  return {
    model: { hitKind },
    ...(vx === undefined ? {} : { rigidBody: { linvel: () => ({ x: vx }) } }),
  };
}

test("头部装备对 bullet/laser/explosion/melee 都优先吸收", () => {
  for (const [hitKind, vx] of [["bullet", 100], ["laser", 100], ["explosion", 100], ["melee", undefined]]) {
    resetSim();
    const { model, entity } = spawnMob(CapZombieData, { col: 8, row: 2 });
    entity.takeDamage(100, undefined, source(hitKind, vx));
    assert.equal(model.helmetHealth, 270, `${hitKind} 应由帽子吸收`);
    assert.equal(model.health, 300, `${hitKind} 不应打到本体`);
  }
});

test("头部破碎时默认溢出到本体", () => {
  resetSim();
  const { model, entity } = spawnMob(CapZombieData, { col: 8, row: 2 });
  entity.takeDamage(400, undefined, source("bullet", 100));
  assert.equal(model.helmetHealth, 0);
  assert.equal(model.helmetBroken, true);
  assert.equal(model.health, 270);
});

test("头部 immuneOverkill=true 时丢弃超杀伤害", () => {
  resetSim();
  const data = new ZombieModel({
    mid: 999,
    nameKey: "ImmuneHeadTest",
    level: 1,
    weight: () => 0,
    maxHealth: 300,
    baseSpeed: 0,
    baseAttackDamage: 0,
    equipment: {
      head: {
        key: "attach/cap",
        maxHealth: 100,
        thresholds: [],
        immuneOverkill: true,
      },
    },
    createEntity: (scene, col, row, model, waveID) =>
      new ZombieEntity(scene, col, row, model, waveID),
  });
  const { model, entity } = spawnMob(data, { col: 8, row: 2 });
  entity.takeDamage(200, undefined, source("bullet", 100));
  assert.equal(model.helmetHealth, 0);
  assert.equal(model.helmetBroken, true);
  assert.equal(model.health, 300, "超杀部分不应进入本体");
});

test("木盾只挡正面 bullet，反向 bullet 直接打本体", () => {
  resetSim();
  const forward = spawnMob(VindicatorSoliderData, { col: 8, row: 2 });
  forward.entity.takeDamage(100, undefined, source("bullet", 100));
  assert.equal(forward.model.shieldHealth, 950);
  assert.equal(forward.model.health, 360);

  resetSim();
  const reverse = spawnMob(VindicatorSoliderData, { col: 8, row: 2 });
  reverse.entity.takeDamage(100, undefined, source("bullet", -100));
  assert.equal(reverse.model.shieldHealth, 1000);
  assert.equal(reverse.model.health, 260);
});

test("laser/explosion 同时伤害木盾和本体", () => {
  for (const hitKind of ["laser", "explosion"]) {
    resetSim();
    const { model, entity } = spawnMob(VindicatorSoliderData, { col: 8, row: 2 });
    entity.takeDamage(100, undefined, source(hitKind, 100));
    assert.equal(model.shieldHealth, 950, `${hitKind} 应伤害木盾`);
    assert.equal(model.health, 260, `${hitKind} 应同时伤害本体`);
  }
});

test("木船优先本体，爆炸同时打坐骑和本体", () => {
  resetSim();
  const { model, entity } = spawnMob(BoatZombieData, { col: 8, row: 2 });
  entity.takeDamage(100, undefined, source("bullet", 100));
  assert.equal(model.health, 200);
  assert.equal(model.mountHealth, 400);

  entity.takeDamage(100, undefined, source("explosion", 100));
  assert.equal(model.mountHealth, 300);
  assert.equal(model.health, 100);
});

test("海豚优先坐骑，爆炸同时打坐骑和本体", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  entity.takeDamage(100, undefined, source("bullet", 100));
  assert.equal(model.mountHealth, 150);
  assert.equal(model.health, 300);

  entity.takeDamage(100, undefined, source("explosion", 100));
  assert.equal(model.mountHealth, 50);
  assert.equal(model.health, 200);
});

test("战斧提供 12 近战伤害，破碎后回到空手 20", () => {
  resetSim();
  const { model, entity } = spawnMob(VindicatorData, { col: 8, row: 2 });
  assert.equal(model.baseAttackDamage, 20);
  assert.equal(model.getAttackDamage(), 32);

  model.breakMainHand(entity);
  assert.equal(model.getAttackDamage(), 20);
});

test("镐子 20 次攻击后破碎并降低攻击力", () => {
  resetSim();
  const { model, entity } = spawnMob(MinerZombieData, { col: 8, row: 2 });
  assert.equal(model.getAttackDamage(), 60);
  for (let i = 0; i < 20; i++) model.onAttackLanded(entity);

  assert.equal(model.equipment.mainHand.health, 0);
  assert.equal(model.equipment.mainHand.broken, true);
  assert.equal(model.equipment.mainHand.visible, false);
  assert.equal(model.getAttackDamage(), 20);
});

test("BalloonTntClone 是召唤物，不属于中型怪物", () => {
  assert.equal(typeof BalloonTntCloneData.takeMediumDamage, "undefined");
  assert.equal(BalloonTntCloneData.equipment, undefined);

  resetSim();
  const { model, entity } = spawnMob(BalloonTntCloneData, { col: 8, row: 2 });
  assert.equal(typeof model.takeMediumDamage, "undefined");
  entity.takeDamage(10, undefined, source("explosion", 100));
  assert.equal(model.health, 190);
});

test("潜水氧气面罩 100 血，吸收 10% 伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  assert.equal(model.equipment.head.maxHealth, 100);
  assert.equal(model.equipment.head.health, 100);

  entity.takeDamage(100, undefined, source("bullet", 100));
  assert.equal(model.equipment.head.health, 90, "面罩吸收 10 点");
  assert.equal(model.health, 210, "本体承担 90 点");

  entity.takeDamage(1000, undefined, source("bullet", 100));
  assert.equal(model.equipment.head.health, 0);
  assert.equal(model.equipment.head.broken, true);
  assert.equal(model.health, 0);
});

test("弓耐久耗尽后不可继续射击", () => {
  resetSim();
  const { model, entity } = spawnMob(SkeletonBowData, { col: 8, row: 2 });
  model.equipment.mainHand.health = 1;
  model.onAttackLanded(entity);

  assert.equal(model.equipment.mainHand.broken, true);
  assert.equal(model.isMainHandUsable(), false);
});
