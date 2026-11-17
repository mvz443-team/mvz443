import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget, tick } from "../harness/sim.mjs";
import { StickZombieData } from "../../src/game/presets/monster/zombie/stick_zombie.ts";

/**
 * 描述（StickZombie）：
 *   手杖僵尸遇到植物时撑杆跳过：消耗手杖、进入飞行、速度×2.2；
 *   落地后速度变为原来的 0.5，若落点有植物则直接开始攻击。
 *
 * 验收路径：
 *   1) 检查 hasStick 与手杖武器。
 *   2) 调用 tryStartVault，检查手杖消耗、isFlying、速度与目标 x。
 *   3) 调用 finishVault，检查速度减半、武器隐藏、恢复移动。
 *   4) 带落点植物时 finishVault 应进入攻击状态并造成 30 伤害。
 *
 * 预期结果：
 *   tryStartVault 返回 true，hasStick=false，isFlying=true，
 *   velocityX=-originalSpeed×2.2；finishVault 后 speed=originalSpeed×0.5、
 *   weaponVisible=false；有目标时 200ms 内造成 30 伤害。
 *
 * 为什么：
 *   tryStartVault 直接修改 Model 的 hasStick/isFlying/vaultTargetX；
 *   finishVault 调用 consumeWeapon 并 tryStartAttack；
 *   StickZombieData.attackDamage=30。
 */

test("撑杆跳消耗手杖并加速到 2.2 倍", () => {
  resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2 });
  const originalSpeed = model.originalSpeed;

  assert.equal(model.hasStick, true);
  assert.equal(model.weaponKey, "attach/hd_stick");
  assert.equal(model.canVaultOverPlant(plant), true);
  assert.equal(model.tryStartVault(entity, plant), true);

  assert.equal(model.hasStick, false);
  assert.equal(model.isFlying, true);
  assert.equal(entity.velocityX, -originalSpeed * 2.2);
  assert.equal(model.vaultTargetX < entity.x, true);
});

test("落地后速度减半并隐藏手杖", () => {
  resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2 });
  const originalSpeed = model.originalSpeed;
  model.tryStartVault(entity, plant);
  entity.x = model.vaultTargetX;

  assert.equal(model.shouldFinishVault(entity), true);
  model.finishVault(entity);

  assert.equal(model.isFlying, false);
  assert.equal(model.speed, originalSpeed * 0.5);
  assert.equal(model.weaponVisible, false);
  assert.equal(entity.moveCalls.includes("start"), true);
});

test("落点有植物时直接攻击并造成 30 伤害", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(StickZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2, hp: 100 });
  model.tryStartVault(entity, plant);
  entity.x = model.vaultTargetX;
  model.onVaultCollision(entity, plant);

  model.finishVault(entity);
  assert.equal(model.attackingId, plant.SnapshotId);
  assert.equal(model.isStop, true);

  tick(sim, 200);
  assert.equal(plant.model.health, 70);
});
