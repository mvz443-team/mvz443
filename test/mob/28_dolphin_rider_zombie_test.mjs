import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob } from "../harness/sim.mjs";
import {
  DolphinRiderZombieData,
  DolphinRiderEntity,
} from "../../src/game/presets/monster/zombie/water/dolphin_rider_zombie.ts";
import { MonsterEntity } from "../../src/game/models/entities/MonsterEntity.ts";
import { MonsterSpeed } from "../../src/constants/game.ts";
import { PositionManager } from "../../src/game/managers/view/PositionManager.ts";

/**
 * 描述（海豚骑乘僵尸 mid 28）：
 *   骑手是普通僵尸（300 血），坐骑海豚 250 血，默认"优先打坐骑"。
 *   bullet/laser 由坐骑吸收；explosion 同时结算坐骑与本体。坐骑破后骑手
 *   以普通僵尸速度继续行动，并在水面开始溺亡。坐姿两腿常驻顺时针 30°。
 *
 * 验收路径：
 *   1) spawnMob 检查坐骑血/优先级/初始速度。
 *   2) 用 MonsterEntity.prototype.takeDamage 驱动带 hitKind 的伤害，检查路由。
 *   3) 切到 rider 优先级验证 bullet 打本体。
 *   4) 骑乘者死亡验证整体死亡；坐骑破碎验证速度回落。
 *   5) 检查海豚图层锚点与坐姿同步。
 *
 * 预期结果：
 *   mountHealth=250、priority='mount'、speed=StickZombie；
 *   bullet 100 → 坐骑 150 / 本体 300；laser 同；explosion 100 → 坐骑 150 且本体 200；
 *   rider 优先级 bullet 10 → 本体 290 / 坐骑 250；
 *   本体归零后 mountBroken=true；syncView 后 riding/图层可见性与坐骑一致。
 *
 * 为什么：
 *   坐骑字段与伤害路由都在通用 MonsterModel/MonsterEntity，进快照且跨端一致；
 *   hitKind 由 readProjectileHitKind 显式读取，爆炸穿透是唯一例外。
 */

function source(hitKind) {
  return { model: { hitKind } };
}

function hit(entity, amount, hitKind = "bullet") {
  entity.updateBodyDamageStage ??= () => {};
  MonsterEntity.prototype.takeDamage.call(entity, amount, undefined, source(hitKind));
}

function sync(entity) {
  entity.animController.setRidingPose ??= (value) => { entity.animController.riding = value; };
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
  assert.equal(entity.attachSprites.get("dolphin_body").visible, true);

  model.breakMount(entity);
  sync(entity);
  assert.equal(entity.animController.riding, false);
  assert.equal(entity.attachSprites.get("dolphin_body").visible, false);
});
