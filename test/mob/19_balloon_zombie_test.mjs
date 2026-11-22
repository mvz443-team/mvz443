import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnMob,
  makePlantTarget,
  getPlantsMap,
  PositionManager,
} from "../harness/sim.mjs";
import { BalloonZombieData } from "../../src/game/presets/monster/zombie/chapter2/balloon_zombie.ts";

/**
 * 描述（气球僵尸）：
 *   气球僵尸默认由飞行载具（3 个红气球）支撑，flying = true，载具只有 1 点血。
 *   飞行载具只抵挡 bullet：子弹把气球打爆并迫降，本次伤害完全由载具承担，
 *   僵尸本体不受伤；laser / explosion 会同时打爆气球并伤到本体。
 *   载具归零后 flying = false，变成普通地面僵尸（300 血、20 伤害、200ms 攻击间隔）。
 *   飞行到移动方向上的最后一格（向左即 col 0，按格子边界判定）时，气球主动死亡降落，
 *   与被子弹打爆走同一条 breakVehicle 路径，不伤本体。
 *
 * 验收路径：
 *   1) spawnMob 后检查 flying / vehicleHealth / bodyLayers。
 *   2) 直接调用 model.absorbVehicleDamage（= Entity.takeDamage 的第一站）
 *      分别传入 hitKind 为 bullet / laser / explosion 的伤害来源。
 *   3) 穿透类伤害再调用 model.takeDamage，检查本体掉血。
 *   4) 检查飞行中 canStartAttack 为 false，落地后为 true。
 *   5) 落地后把植物放进同一格，驱动 onModelStep 验证补判普攻。
 *   6) 把 entity.x 推到 col 0 右边界前后，驱动 onModelStep 验证边界降落；
 *      再反转 speed 验证判定跟随移动方向而不是硬编码 col 0。
 *
 * 预期结果：
 *   初始 vehicleHealth = 1、flying = true、health = 300；
 *   bullet → 吸收返回 true、本体 300、flying = false；
 *   laser / explosion → 吸收返回 false、本体 200、flying = false；
 *   载具只破碎一次，重复命中不再触发 syncView；
 *   进入 col 0 右边界即 vehicleBroken=true / flying=false / health 仍为 300，
 *   未进最后一格不触发；speed 反转后改在最右列触发。
 *
 * 为什么：
 *   FlyingMonsterModel.absorbVehicleDamage 读取 readProjectileHitKind(source)，
 *   只有 "bullet" 返回 true；breakVehicle 同时写 vehicleBroken / vehicleHealth=0 /
 *   flying=false 三个快照字段；Rapier sensor 只在 overlap-start 派发事件，
 *   所以落地后必须由 onModelStep 补一次脚下植物判定；
 *   hasEnteredLastCellInMoveDirection 由 speed 符号推导最后一格并按格子边界触发，
 *   x 来自刚体快照，重放/回滚结果一致。
 */

function source(hitKind) {
  return { model: { hitKind } };
}

test("初始状态：载具在架，flying=true", () => {
  resetSim();
  const { model } = spawnMob(BalloonZombieData, { col: 8, row: 2 });

  assert.equal(model.mid, 19);
  assert.equal(model.maxHealth, 300);
  assert.equal(model.health, 300);
  assert.equal(model.vehicleHealthMax, 1);
  assert.equal(model.vehicleHealth, 1);
  assert.equal(model.vehicleBroken, false);
  assert.equal(model.hasVehicle, true);
  assert.equal(model.flying, true);
  assert.deepEqual(model.bodyLayers, { tiny: false, flying: true, inVoid: false });
  assert.equal(model.bodyLayerNames, "flying");
});

test("子弹只打爆气球，本体不受伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonZombieData, { col: 8, row: 2 });

  const absorbed = model.absorbVehicleDamage(entity, 100, undefined, source("bullet"));

  assert.equal(absorbed, true);
  assert.equal(model.vehicleHealth, 0);
  assert.equal(model.vehicleBroken, true);
  assert.equal(model.flying, false);
  assert.equal(model.health, 300);
  assert.equal(entity.viewCalls.includes("syncView"), true);
});

test("激光由载具吸收（与 bullet 一致），本体不受伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonZombieData, { col: 8, row: 2 });

  const absorbed = model.absorbVehicleDamage(entity, 100, undefined, source("laser"));
  assert.equal(absorbed, true);
  assert.equal(model.vehicleBroken, true);
  assert.equal(model.flying, false);
  assert.equal(model.health, 300, "bullet/laser 由坐骑吸收，只有 explosion 同时结算二者");
});

test("爆炸同时打爆气球并伤害本体", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonZombieData, { col: 8, row: 2 });

  assert.equal(model.absorbVehicleDamage(entity, 100, undefined, source("explosion")), false);
  model.takeDamage(entity, 100);
  assert.equal(model.health, 200);
});

test("载具只破碎一次，重复命中直接打到本体", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonZombieData, { col: 8, row: 2 });

  model.absorbVehicleDamage(entity, 1, undefined, source("bullet"));
  const syncCount = entity.viewCalls.filter((call) => call === "syncView").length;

  assert.equal(model.absorbVehicleDamage(entity, 1, undefined, source("bullet")), false);
  assert.equal(model.absorbVehicleDamage(entity, 1, undefined, source("laser")), false);
  assert.equal(entity.viewCalls.filter((call) => call === "syncView").length, syncCount);
  assert.equal(model.vehicleHealth, 0);
});

test("飞行中越过植物，落地后才恢复地面普攻", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2, hp: 100 });

  assert.equal(model.canStartAttack(plant), false);

  model.absorbVehicleDamage(entity, 1, undefined, source("bullet"));
  assert.equal(model.canStartAttack(plant), true);
});

test("落地后补判脚下植物并开始攻击", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 8, row: 2, hp: 100 });

  const col = PositionManager.Instance.getColByX(entity.x);
  const row = entity.GetRow();
  getPlantsMap().set(`${col}-${row}`, [plant]);

  // 飞行中不补判。
  model.onModelStep(entity);
  assert.equal(model.attackingId, null);

  model.absorbVehicleDamage(entity, 1, undefined, source("bullet"));
  model.onModelStep(entity);

  assert.equal(model.attackingId, plant.SnapshotId);
  assert.equal(model.isStop, true);
});

test("进入移动方向最后一格（col 0）时气球主动降落，不伤本体", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonZombieData, { col: 8, row: 2 });

  // 出生点（col 8）尚未进入最后一格。
  model.onModelStep(entity);
  assert.equal(model.hasVehicle, true);
  assert.equal(model.flying, true);

  // 还在 col 1（col 0 右边界再往右一点）：不触发。
  const col0Right = PositionManager.Instance.getGridTopLeft(0, 2).x
    + PositionManager.Instance.GRID_SIZEX;
  entity.x = col0Right + 1;
  model.onModelStep(entity);
  assert.equal(model.hasVehicle, true);

  // 刚踏进 col 0 的右边界：气球主动死亡降落。
  entity.x = col0Right;
  model.onModelStep(entity);

  assert.equal(model.vehicleBroken, true);
  assert.equal(model.vehicleHealth, 0);
  assert.equal(model.hasVehicle, false);
  assert.equal(model.flying, false);
  assert.equal(model.health, 300, "主动降落不伤本体");
  assert.equal(entity.moveCalls.includes("start"), true);
  assert.equal(entity.viewCalls.includes("syncView"), true);

  // 一次性：重复驱动不会重复走 breakMount。
  const syncCount = entity.viewCalls.filter((call) => call === "syncView").length;
  model.onModelStep(entity);
  assert.equal(entity.viewCalls.filter((call) => call === "syncView").length, syncCount);
});

test("移动方向反转后，最后一格判定跟随 speed 而不是硬编码 col 0", () => {
  resetSim();
  const { model, entity } = spawnMob(BalloonZombieData, { col: 4, row: 2 });

  // 向右飞：speed 取负，最后一格变成最右列。
  model.speed = -Math.abs(model.speed);

  // 即便 x 落在 col 0 也不触发。
  entity.x = PositionManager.Instance.getGridTopLeft(0, 2).x;
  model.onModelStep(entity);
  assert.equal(model.hasVehicle, true);

  // 进入最右列左边界才触发。
  const lastCol = PositionManager.Instance.Col_Number - 1;
  entity.x = PositionManager.Instance.getGridTopLeft(lastCol, 2).x;
  model.onModelStep(entity);
  assert.equal(model.hasVehicle, false);
  assert.equal(model.flying, false);
});
