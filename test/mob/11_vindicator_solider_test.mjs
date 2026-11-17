import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob } from "../harness/sim.mjs";
import { VindicatorSoliderData } from "../../src/game/presets/monster/zombie/vindicator_solider.ts";
import { BulletEntity } from "../harness/stubs/bullet-entity.mjs";

/**
 * 描述（VindicatorSolider）：
 *   盾卫拥有 1000 血铁盾（减伤 0.5）与战斧；
 *   只格挡朝自己飞来的子弹（facingX=-1，因此 vx>0 才格挡）；
 *   盾破时本次伤害按完整值结算（shieldBreakOverflow 返回 amount）。
 *
 * 验收路径：
 *   1) 检查 shieldKey/weaponKey/盾血量。
 *   2) 用 BulletEntity 替身构造 vx>0 与 vx<0 的子弹，调用 canShieldBlock。
 *   3) 两次 1000 伤害：第一次盾剩 500，第二次破盾并结算完整 1000。
 *   4) 非子弹来源不格挡。
 *
 * 预期结果：
 *   vx=100 可格挡，vx=-100 不格挡；1000 伤害→盾 500、本体 360；
 *   再 1000→盾 0、shieldBroken、本体 0；非子弹来源 absorb 返回 false。
 *
 * 为什么：
 *   canShieldBlock 要求 source instanceof BulletEntity 且 vx*facingX<0；
 *   盾减伤 0.5；shieldBreakOverflow 返回原始 amount。
 */

test("铁盾与战斧数值", () => {
  resetSim();
  const { model } = spawnMob(VindicatorSoliderData, { col: 8, row: 2 });

  assert.equal(model.mid, 11);
  assert.equal(model.shieldKey, "attach/hd_shield");
  assert.equal(model.shieldHealth, 1000);
  assert.equal(model.shieldDef.damageScale, 0.5);
  assert.equal(model.weaponKey, "attach/hd_axe");
});

test("只格挡朝自己飞来的子弹", () => {
  resetSim();
  const { model, entity } = spawnMob(VindicatorSoliderData, { col: 8, row: 2 });
  const incoming = new BulletEntity({ vx: 100, faction: 1 });
  const outgoing = new BulletEntity({ vx: -100, faction: 1 });

  assert.equal(model.canShieldBlock(entity, incoming), true);
  assert.equal(model.canShieldBlock(entity, outgoing), false);
  assert.equal(model.canShieldBlock(entity, undefined), false);
});

test("1000 伤害先扣 500 盾，破盾时结算完整伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(VindicatorSoliderData, { col: 8, row: 2 });
  const bullet = new BulletEntity({ vx: 100, faction: 1 });

  assert.equal(model.absorbShieldDamage(entity, 1000, undefined, bullet), true);
  assert.equal(model.shieldHealth, 500);
  assert.equal(model.health, 360);

  assert.equal(model.absorbShieldDamage(entity, 1000, undefined, bullet), true);
  assert.equal(model.shieldHealth, 0);
  assert.equal(model.shieldBroken, true);
  assert.equal(model.health, 0);
});

test("非子弹来源不会被盾格挡", () => {
  resetSim();
  const { model, entity } = spawnMob(VindicatorSoliderData, { col: 8, row: 2 });

  assert.equal(model.absorbShieldDamage(entity, 1000), false);
  assert.equal(model.shieldHealth, 1000);
  assert.equal(model.health, 360);
});
