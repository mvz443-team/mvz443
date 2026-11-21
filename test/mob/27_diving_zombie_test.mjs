import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget } from "../harness/sim.mjs";
import {
  DivingZombieData,
  DivingZombieEntity,
} from "../../src/game/presets/monster/zombie/water/diving_zombie.ts";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { readBodyLayers, canReachBody } from "../../src/game/core/logic/BodyTraits.ts";
import { PositionManager } from "../../src/game/managers/view/PositionManager.ts";

/**
 * 描述（潜水僵尸 mid 27）：
 *   潜水僵尸是普通僵尸套上潜水镜/呼吸管两个独立图层的Form，血量、速度、伤害与普通僵尸一致，
 *   只能在水面行刷新。非攻击时 tiny=true（半潜在水下），只有带 tiny 触及能力的投射物能命中；
 *   开始攻击时抬起身体 tiny=false，之后普通投射物也能命中；停止攻击后重新潜下 tiny=true。
 *   small dispenser 的判定线与雪球都带 tiny=true，因此仍能在其潜下时打到它。
 *
 * 验收路径：
 *   1) spawnMob 读取 mid / 数值 / habitats / 初始 tiny。
 *   2) 调用真实 tryStartAttack / stopAttacking，观察 tiny 切换。
 *   3) 用 BodyTraits.canReachBody 验证 tiny 雪球可命中潜下状态、普通子弹不可。
 *   4) 对比普通僵尸的定义，确认数值一致且不会误带 tiny。
 *
 * 预期结果：
 *   mid=27、health=300、damage=20、baseSpeed 与普通僵尸相同、habitats=['water']；
 *   初始 tiny=true；tryStartAttack 成功后 tiny=false；stopAttacking 后 tiny=true；
 *   潜下时 canReachBody({tiny:true}, 目标) = true，canReachBody({}, 目标) = false；
 *   普通僵尸 tiny 恒为 false。
 *
 * 为什么：
 *   DivingZombieModel 只覆写 onCreate / tryStartAttack / stopAttacking 三个钩子，
 *   tiny 是 LogicModel 普通字段自动进快照，回滚后能恢复到正确的潜行/攻击体态；
 *   canReachBody 规定"目标占据的每一层，攻击方都必须能到达"，tiny 目标必须 tiny 投射物。
 */

test("潜水僵尸定义：普通僵尸数值 + 水生 + 初始潜行", () => {
  resetSim();
  const { model } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  assert.equal(model.mid, 27);
  assert.equal(model.maxHealth, 300);
  assert.equal(model.health, 300);
  assert.equal(model.attackDamage, 20);
  assert.equal(model.baseSpeed, ZombieData.baseSpeed);
  assert.deepEqual(model.habitats, ["water"]);
  assert.equal(model.tiny, true);
  assert.deepEqual(model.bodyLayers, { tiny: true, flying: false, inVoid: false });
});

test("攻击时抬起（tiny=false），停攻后潜下（tiny=true）", () => {
  resetSim();
  const { model, entity } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 6, row: 2 });

  assert.equal(model.tryStartAttack(entity, plant), true);
  assert.equal(model.tiny, false);
  assert.equal(model.isStop, true);

  model.stopAttacking(entity);
  assert.equal(model.tiny, true);
  assert.equal(model.isStop, false);
});

test("同格多植物接力换目标：全程不潜水", () => {
  resetSim();
  const { model, entity } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  const shield = makePlantTarget({ col: 6, row: 2, pid: 19 });
  const inner = makePlantTarget({ col: 6, row: 2, pid: 1 });

  assert.equal(model.tryStartAttack(entity, shield), true);
  assert.equal(model.tiny, false);

  // 目标销毁后的接力走 retargetAttack，不经过 stopAttacking。
  model.retargetAttack(entity, inner);
  assert.equal(model.tiny, false, "接力期间保持探出，不潜水");

  // 更高优先级植物出现导致 tryStartAttack 内部先 stopAttacking，也必须抑制潜水。
  entity.viewCalls.length = 0;
  assert.equal(model.tryStartAttack(entity, shield), true);
  assert.equal(model.tiny, false);
  const dives = entity.viewCalls.filter((v) => v === "syncView").length;
  assert.equal(dives, 0, "优先级换目标不应触发潜水/起身动画");
});

test("攻击生命周期立即切 tiny，潜水动画由视图单向同步", () => {
  resetSim();
  const { model, entity } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 6, row: 2 });
  entity.syncRegisteredAttachments = () => {};

  DivingZombieEntity.prototype.syncViewFromModel.call(entity);
  assert.equal(entity.animController.diving, true, "常态只显示头部");

  model.tryStartAttack(entity, plant);
  DivingZombieEntity.prototype.syncViewFromModel.call(entity);
  assert.equal(model.tiny, false, "动画开始前逻辑已失去 tiny");
  assert.equal(entity.animController.diving, false, "攻击态探出身来");

  model.stopAttacking(entity);
  DivingZombieEntity.prototype.syncViewFromModel.call(entity);
  assert.equal(model.tiny, true, "动画开始前逻辑已获得 tiny");
  assert.equal(entity.animController.diving, true);
});

test("氧气面罩按帽子挂点绘制（同一高度/缩放/注册方式）", () => {
  resetSim();
  const { entity } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  DivingZombieEntity.prototype.buildView.call(entity);

  const goggles = entity.attachSprites.get("diving_goggles");
  const snorkel = entity.attachSprites.get("diving_snorkel");
  assert.ok(goggles && snorkel, "面罩与呼吸管两个独立图层");
  const scale = PositionManager.Instance.scaleFactor;
  assert.equal(goggles.y, entity.y + entity.offsetY - PositionManager.Instance.GRID_SIZEY * 1.15,
    "与 cap zombie 帽子相同的 y 高度");
  assert.equal(goggles.scaleX, scale);
  assert.equal(goggles.originY, 0.5);
  assert.ok(snorkel.x > goggles.x, "呼吸管在面罩右侧");
});

test("潜水僵尸对地形水免疫", () => {
  resetSim();
  const { model } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  assert.equal(model.canDrown, false);
});

test("tiny 雪球能命中潜下状态，普通子弹不能", () => {
  resetSim();
  const { entity } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  const layers = readBodyLayers(entity);
  assert.equal(canReachBody({ tiny: true, flying: false, inVoid: false }, layers), true);
  assert.equal(canReachBody({ tiny: false, flying: false, inVoid: false }, layers), false);

  resetSim();
  const plain = spawnMob(ZombieData, { col: 8, row: 2 });
  assert.equal(plain.model.tiny, false);
  assert.equal(canReachBody({ tiny: false, flying: false, inVoid: false }, readBodyLayers(plain.entity)), true);
});
