import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnMob,
  makePlantTarget,
  getPlantsMap,
  tick,
  PositionManager,
} from "../harness/sim.mjs";
import { StickZombieData } from "../../src/game/presets/monster/zombie/stick_zombie.ts";

/**
 * 描述（StickZombie）：
 *   手杖僵尸有两道确定性起跳入口：
 *   1) 判定线（提供原版的提前量）：身体中心沿移动方向（向左）0.7 格内有存活植物 → 起跳；
 *   2) 普攻入口拦截（修"行进中现放植物只啃不跳"）：Rapier 的 overlap-start 在固定帧里
 *      先于 Entity.stepUpdate 派发，现放植物会先走 tryStartAttack 把 isStop 锁死；
 *      StickZombieModel.tryStartAttack 在写入攻击状态 / 建攻击 timer 之前先判起跳。
 *   起跳消耗手杖、速度×2.2、固定向前飞 1.4 格；落地速度变为原来的 0.5，
 *   若落点（脚下格子）有植物则直接开始攻击；手杖已消耗后接触植物改为啃食。
 *
 * 验收路径：
 *   1) 植物放在判定线内/外，驱动 onModelStep 观察是否起跳。
 *   2) 植物放在判定线盲区（中心落在身体右侧）走 tryStartAttack，观察是否拦截起跳、
 *      是否误建攻击 timer / 置 isStop。
 *   3) 飞行中再次接触、落地后再次接触，观察防重与普攻切换。
 *   4) 调用 finishVault，检查速度减半、武器隐藏、恢复移动；落点有植物则造成 30 伤害。
 *
 * 预期结果：
 *   判定线 0.7 格内 → 起跳；0.75 格外 → 不起跳；
 *   盲区植物走碰撞入口 → 起跳、isStop=false、attackingId=null、attackTimer=null、
 *   200ms 后植物满血；飞行中接触不建攻击；落地后接触转普攻，200ms 造成 30 伤害。
 *   vaultTargetX = x - 1.4 × GRID_SIZEX；落地后 speed = originalSpeed × 0.5、
 *   weaponVisible = false。
 *
 * 为什么：
 *   CombatManager 固定帧顺序为 Deferred.flush → rapier 碰撞事件 → stepUpdate(onModelStep)，
 *   所以判定线会被先到的碰撞抢占，必须在 tryStartAttack 入口补拦截。
 *   两道入口都只依赖 Model 快照字段（hasStick/flying/health）与确定的实体类型，
 *   起跳不建 timer，不触碰 beginAttackTimer 的 removeByEvent 兜底语义，不引入 desync。
 *   判定线目标用"距离近者优先 + pid/SnapshotId 兜底"的全序，避免依赖数组插入顺序。
 *   finishVault 用 PlantHelper.GetPlantsInGrid 补判脚下植物
 *   （跳跃期间 overlap 事件已被 onVaultCollision 吞掉，不会重新派发）。
 */

const GRID_X = PositionManager.Instance.GRID_SIZEX;

function putPlantAt(col, row, plant) {
  getPlantsMap().set(`${col}-${row}`, [plant]);
}

test("判定线 0.7 格内有植物就起跳，固定飞 1.4 格", () => {
  resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2 });
  // 植物放在身体左侧 0.5 格（判定线内）
  plant.x = entity.x - GRID_X * 0.5;
  getPlantsMap().set("4-2", [plant]);

  const startX = entity.x;
  const originalSpeed = model.originalSpeed;

  assert.equal(model.hasStick, true);
  assert.equal(model.weaponKey, "attach/hd_stick");

  model.onModelStep(entity);

  assert.equal(model.hasStick, false);
  assert.equal(model.flying, true);
  assert.equal(model.vaultTargetX, startX - GRID_X * 1.4);
  assert.equal(model.originalSpeed, originalSpeed);
});

test("判定线外（0.75 格）的植物不会触发起跳", () => {
  resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2 });
  plant.x = entity.x - GRID_X * 0.75;
  getPlantsMap().set("4-2", [plant]);

  model.onModelStep(entity);

  assert.equal(model.hasStick, true);
  assert.equal(model.flying, false);
});

test("落地后速度减半并隐藏手杖", () => {
  resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const originalSpeed = model.originalSpeed;

  model.tryStartVault(entity);
  assert.equal(model.flying, true);

  entity.x = model.vaultTargetX;
  assert.equal(model.shouldFinishVault(entity), true);

  model.finishVault(entity);

  assert.equal(model.flying, false);
  assert.equal(model.speed, originalSpeed * 0.5);
  assert.equal(model.weaponVisible, false);
});

test("落点有植物时直接攻击并造成 30 伤害", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2, hp: 100 });

  model.tryStartVault(entity);
  entity.x = PositionManager.Instance.getZombieBottomCenter(4, 2).x;
  putPlantAt(4, 2, plant);

  model.finishVault(entity);
  assert.equal(model.attackingId, plant.SnapshotId);
  assert.equal(model.isStop, true);

  tick(sim, 200);
  assert.equal(plant.model.health, 70);
});

test("跳跃期间碰到植物只被记录，不会打断飞行", () => {
  resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2 });

  model.tryStartVault(entity);
  assert.equal(model.onVaultCollision(entity, plant), true);
  assert.equal(model.flying, true);
  assert.equal(model.attackingId, null);
});

test("没有手杖时不会再次起跳", () => {
  resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });

  model.tryStartVault(entity);
  model.flying = false;

  assert.equal(model.tryStartVault(entity), false);
  assert.equal(model.flying, false);
});

test("行进中现放的植物：碰撞入口拦截起跳，不啃食也不建攻击 timer", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 8, row: 2, hp: 100 });
  // 现放植物中心落在身体右侧 0.3 格：判定线看不到它，但 Rapier 会派发 overlap-start。
  plant.x = entity.x + GRID_X * 0.3;
  getPlantsMap().set("8-2", [plant]);

  assert.equal(model.findPlantOnVaultLine(entity), null);

  const startX = entity.x;
  assert.equal(model.tryStartAttack(entity, plant), true);

  assert.equal(model.flying, true);
  assert.equal(model.hasStick, false);
  assert.equal(model.isStop, false);
  assert.equal(model.attackingId, null);
  assert.equal(entity.attackTimer, null);
  assert.equal(model.vaultTargetX, startX - GRID_X * 1.4);

  tick(sim, 200);
  assert.equal(plant.model.health, 100);
});

test("真实碰撞链路：实体收到 overlap 后走 Model 拦截起跳而非开啃", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 8, row: 2, hp: 100 });
  plant.x = entity.x + GRID_X * 0.3;
  getPlantsMap().set("8-2", [plant]);

  entity.onCollision({ sourceEntity: entity, targetEntity: plant });

  assert.equal(model.flying, true);
  assert.equal(model.isStop, false);
  assert.equal(model.attackingId, null);
  assert.equal(entity.attackTimer, null);

  tick(sim, 200);
  assert.equal(plant.model.health, 100);
});

test("飞行中再次接触植物不建攻击，也不二次起跳", () => {
  resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 6, row: 2 });

  assert.equal(model.tryStartVault(entity), true);
  const vaultTargetX = model.vaultTargetX;

  assert.equal(model.tryStartAttack(entity, plant), true);
  assert.equal(model.vaultTargetX, vaultTargetX);
  assert.equal(model.flying, true);
  assert.equal(model.attackingId, null);
  assert.equal(entity.attackTimer, null);
});

test("落地后手杖已消耗，再接触植物改为啃食而不是二次起跳", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2, hp: 100 });

  model.tryStartVault(entity);
  entity.x = PositionManager.Instance.getZombieBottomCenter(4, 2).x;
  model.finishVault(entity);
  assert.equal(model.flying, false);
  assert.equal(model.hasStick, false);

  assert.equal(model.tryStartAttack(entity, plant), true);
  assert.equal(model.isStop, true);
  assert.equal(model.attackingId, plant.SnapshotId);
  assert.notEqual(entity.attackTimer, null);

  tick(sim, 200);
  assert.equal(plant.model.health, 70);
});
