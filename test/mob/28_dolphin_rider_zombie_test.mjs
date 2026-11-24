import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, makePlantTarget, setGridType, getPlantsMap } from "../harness/sim.mjs";
import {
  DolphinRiderZombieData,
  DolphinRiderEntity,
} from "../../src/game/presets/monster/zombie/water/dolphin_rider_zombie.ts";
import { MonsterEntity } from "../../src/game/models/entities/MonsterEntity.ts";
import { MonsterSpeed } from "../../src/constants/game.ts";
import { PositionManager } from "../../src/game/managers/view/PositionManager.ts";
import { applyMonsterDrowning } from "../../src/game/core/logic/Drowning.ts";

/**
 * 描述（海豚骑乘僵尸 mid 28）：
 *   骑手是普通僵尸（300 血），坐骑海豚 250 血，默认"优先打坐骑"。
 *   bullet/laser 由坐骑吸收；explosion 同时结算坐骑与本体。坐骑破后骑手
 *   以普通僵尸速度继续行动。坐姿两腿常驻顺时针 30°。
 *
 *   撑杆跳是手杖僵尸的水中版本：复用 StickZombieModel/Entity 的判定线与
 *   普攻入口拦截，但一次性消耗品是海豚坐骑——只有 hasMount() 时才能跳一次，
 *   起跳时坐骑仍在架，落地 consumeVault 调 breakMount 让海豚死亡，之后不再起跳。
 *   骑手本体免疫溺水（canDrown:false），海豚破碎后落水也不掉血。
 *
 * 验收路径：
 *   1) spawnMob 检查坐骑血/优先级/初始速度。
 *   2) 用 MonsterEntity.prototype.takeDamage 驱动带 hitKind 的伤害，检查路由。
 *   3) 切到 rider 优先级验证 bullet 打本体。
 *   4) 骑乘者死亡验证整体死亡；坐骑破碎验证速度回落；图层锚点与坐姿同步。
 *   5) 判定线内/盲区植物驱动起跳，落地检查坐骑死亡与防二次起跳。
 *   6) 水格上驱动 applyMonsterDrowning，检查海豚破碎后仍不掉血。
 *
 * 预期结果：
 *   mountHealth=250、priority='mount'、speed=StickZombie、canDrown=false；
 *   bullet 100 → 坐骑 150 / 本体 300；laser 同；explosion 100 → 坐骑 150 且本体 200；
 *   rider 优先级 bullet 10 → 本体 290 / 坐骑 250；
 *   本体归零后 mountBroken=true；syncView 后 riding/图层可见性与坐骑一致。
 *   起跳时 hasMount()=true、mountBroken=false；落地后 mountBroken=true、
 *   hasMount()=false、speed=MonsterSpeed.Zombie、tryStartVault 再调用返回 false。
 *   水格上坐骑破碎后连续 5 帧溺水仍保持 300 血。
 *
 * 为什么：
 *   坐骑字段与伤害路由都在通用 MonsterModel/MonsterEntity，进快照且跨端一致；
 *   hitKind 由 readProjectileHitKind 显式读取，爆炸穿透是唯一例外。
 *   起跳门控与消耗通过 StickZombieModel 的 canVault/consumeVault 钩子覆写，
 *   不复制判定线或碰撞拦截逻辑，保持与手杖僵尸同一套确定性入口。
 *   溺水由 applyMonsterDrowning 的 canDrown 守卫短路，不依赖坐骑状态。
 */

function source(hitKind) {
  return { model: { hitKind } };
}

function hit(entity, amount, hitKind = "bullet") {
  entity.takeDamage(amount, undefined, source(hitKind));
}

function sync(entity) {
  entity.animController.setRidingPose ??= (value, facing) => {
    entity.animController.riding = value;
    entity.animController.ridingFacing = facing;
  };
  MonsterEntity.prototype.syncViewFromModel.call(entity);
}

test("初始状态：海豚 250 血 + 撑杆跳速度 + 优先坐骑", () => {
  resetSim();
  const { model } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  assert.equal(model.mid, 28);
  assert.equal(model.maxHealth, 300);
  assert.equal(model.mountHealth, 250);
  assert.equal(model.mountHealthMax, 250);
  assert.equal(model.mountBroken, false);
  assert.equal(model.hasMount(), true);
  assert.equal(model.mountDamagePriority, "mount");
  assert.equal(model.speed, MonsterSpeed.StickZombie);
  assert.deepEqual(model.habitats, ["water"]);
});

test("bullet/laser 由坐骑吸收，爆炸同时打坐骑与本体", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });

  hit(entity, 100, "bullet");
  assert.equal(model.mountHealth, 150);
  assert.equal(model.health, 300, "bullet 被坐骑吸收");

  hit(entity, 50, "laser");
  assert.equal(model.mountHealth, 100);
  assert.equal(model.health, 300, "laser 同样被坐骑吸收");

  hit(entity, 100, "explosion");
  assert.equal(model.mountHealth, 0);
  assert.equal(model.mountBroken, true);
  assert.equal(model.health, 200, "爆炸穿透坐骑同时打本体");
  assert.equal(model.speed, MonsterSpeed.Zombie, "坐骑破后恢复普通僵尸速度");
});

test("切到优先骑乘者：bullet 直接打本体", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  model.mountDamagePriority = "rider";

  hit(entity, 10, "bullet");
  assert.equal(model.health, 290);
  assert.equal(model.mountHealth, 250);
});

test("骑乘者死亡：坐骑层一并清空（整体死亡）", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  model.mountDamagePriority = "rider";
  hit(entity, 300, "bullet");
  assert.equal(model.health, 0);
  assert.equal(model.mountHealth, 0);
  assert.equal(model.mountBroken, true);
});

test("海豚图层使用与木船僵尸一致的锚点/缩放/深度", () => {
  resetSim();
  const { entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  DolphinRiderEntity.prototype.buildView.call(entity);
  const body = entity.attachSprites.get("dolphin_body");
  assert.ok(body);
  const scaleFactor = PositionManager.Instance.scaleFactor;
  assert.equal(body.originY, 1);
  assert.equal(body.y, entity.y + 15 * scaleFactor);
  assert.equal(body.scaleX, scaleFactor * 1.4);
});

test("骑乘姿态与海豚图层随坐骑状态单向同步", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  for (const key of ["dolphin_body", "dolphin_tail", "dolphin_fin"]) {
    entity.attachSprites.set(key, { setVisible(v) { this.visible = v; } });
  }

  sync(entity);
  assert.equal(entity.animController.riding, true);
  assert.equal(entity.animController.ridingFacing, 1, "speed>0 向左 → 顺时针坐姿");
  assert.equal(entity.attachSprites.get("dolphin_body").visible, true);

  model.speed = -Math.abs(model.speed);
  sync(entity);
  assert.equal(entity.animController.ridingFacing, -1, "speed<0 向右 → 逆时针坐姿");

  model.breakMount(entity);
  sync(entity);
  assert.equal(entity.animController.riding, false);
  assert.equal(entity.attachSprites.get("dolphin_body").visible, false);
});

const GRID_X = PositionManager.Instance.GRID_SIZEX;

test("海豚坐骑存活时判定线内植物触发起跳，坐骑仍在架", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2 });
  plant.x = entity.x - GRID_X * 0.5;
  getPlantsMap().set("4-2", [plant]);

  const startX = entity.x;
  model.onModelStep(entity);

  assert.equal(model.flying, true);
  assert.equal(model.hasMount(), true, "起跳时海豚仍在架");
  assert.equal(model.mountBroken, false);
  assert.equal(model.vaultTargetX, startX - GRID_X * 1.4);
  assert.equal(model.hasStick, false, "骑手没有手杖");
});

test("落地后海豚坐骑死亡，之后无法二次起跳", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });

  assert.equal(model.tryStartVault(entity), true);
  entity.x = model.vaultTargetX;
  assert.equal(model.shouldFinishVault(entity), true);
  model.finishVault(entity);

  assert.equal(model.flying, false);
  assert.equal(model.mountBroken, true);
  assert.equal(model.hasMount(), false);
  assert.equal(model.mountHealth, 0);
  assert.equal(model.speed, MonsterSpeed.Zombie);

  assert.equal(model.tryStartVault(entity), false);
  assert.equal(model.flying, false);
});

test("海豚坐骑已被打碎时不再起跳", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 4, row: 2 });
  plant.x = entity.x - GRID_X * 0.5;
  getPlantsMap().set("4-2", [plant]);

  model.breakMount(entity);
  model.onModelStep(entity);

  assert.equal(model.flying, false);
  assert.equal(model.attackingId, null);
});

test("行进中现放植物：碰撞入口拦截起跳，不啃食也不建攻击 timer", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  const plant = makePlantTarget({ col: 8, row: 2, hp: 100 });
  plant.x = entity.x + GRID_X * 0.3;
  getPlantsMap().set("8-2", [plant]);

  assert.equal(model.findPlantOnVaultLine(entity), null);
  assert.equal(model.tryStartAttack(entity, plant), true);

  assert.equal(model.flying, true);
  assert.equal(model.hasMount(), true, "起跳时尚未消耗坐骑");
  assert.equal(model.isStop, false);
  assert.equal(model.attackingId, null);
  assert.equal(entity.attackTimer, null);
});

test("骑手本体免疫溺水：海豚破碎后落水也不掉血", () => {
  resetSim();
  setGridType(8, 2, "water");
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  assert.equal(model.canDrown, false);

  model.breakMount(entity);
  for (let i = 0; i < 5; i++) applyMonsterDrowning(entity, model);
  assert.equal(model.health, 300);
});
