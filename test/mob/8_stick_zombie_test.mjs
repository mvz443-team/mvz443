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
 *   手杖僵尸不再"撞到植物才跳"：从身体中心沿移动方向（向左）延伸 0.7 格的判定线，
 *   判定线上有任何存活植物时起跳，固定向前飞 1.4 格；起跳消耗手杖、速度×2.2，
 *   落地后速度变为原来的 0.5，若落点（脚下格子）有植物则直接开始攻击。
 *
 * 验收路径：
 *   1) 把植物放在判定线内/外，驱动 onModelStep 观察是否起跳。
 *   2) 检查 hasStick、flying、vaultTargetX（= 起跳点 - 1.4 格）。
 *   3) 调用 finishVault，检查速度减半、武器隐藏、恢复移动。
 *   4) 落点格子注册植物后 finishVault 应进入攻击状态并造成 30 伤害。
 *
 * 预期结果：
 *   判定线 0.7 格内 → 起跳；0.75 格外 → 不起跳；
 *   vaultTargetX = x - 1.4 × GRID_SIZEX；落地后 speed = originalSpeed × 0.5、
 *   weaponVisible = false；落点有植物时 200ms 内造成 30 伤害。
 *
 * 为什么：
 *   findPlantOnVaultLine 用 PlantsManager.GetPlantsByLane 过滤 [x-0.7格, x]；
 *   tryStartVault 不再依赖目标植物，直接按 vaultDistance 计算落点；
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
