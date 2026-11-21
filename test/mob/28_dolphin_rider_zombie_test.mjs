import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob } from "../harness/sim.mjs";
import {
  DolphinRiderZombieData,
  DolphinRiderEntity,
} from "../../src/game/presets/monster/zombie/water/dolphin_rider_zombie.ts";
import { MonsterSpeed } from "../../src/constants/game.ts";
import { PositionManager } from "../../src/game/managers/view/PositionManager.ts";

/**
 * 描述（海豚骑乘僵尸 mid 28）：
 *   单实体内的"坐骑层 + 骑乘者层"：海豚坐骑 20 血，骑乘者是普通僵尸 300 血。
 *   mountDamagePriority='mount' 时伤害先扣坐骑，坐骑破后骑乘者以普通僵尸速度继续行动；
 *   ='rider' 时伤害直接打骑乘者，坐骑不受损。两种优先级下骑乘者死亡都整体死亡。
 *   坐骑在架时 animController 进入骑乘姿态（两腿固定顺时针 20°），三个海豚图层可见。
 *
 * 验收路径：
 *   1) spawnMob 检查 mid / 本体血量 / 坐骑血量 / 初始速度（撑杆跳速度）/ 优先级默认值。
 *   2) 通过 DolphinRiderEntity.prototype.takeDamage 驱动真实伤害路由，分别验证两种优先级。
 *   3) 坐骑破碎后检查速度回落普通僵尸、hasMount=false。
 *   4) 骑乘者被打死时检查坐骑层一并清空（整体死亡）。
 *   5) 通过 prototype.syncViewFromModel 检查坐姿动画与海豚图层可见性同步。
 *
 * 预期结果：
 *   初始 mountHealth=20、mountBroken=false、speed=MonsterSpeed.StickZombie；
 *   优先坐骑：5 伤 → 本体 300 / 坐骑 15；15 伤 → 坐骑破、speed=MonsterSpeed.Zombie；
 *   再 10 伤 → 本体 290；优先骑乘者：10 伤 → 本体 290 / 坐骑仍 20；
 *   本体归零后 mountBroken=true；syncView 后 riding 与坐骑图层可见性一致。
 *
 * 为什么：
 *   坐骑血、破碎标记、优先级都是 Model 普通字段，自动进快照，回滚后不会残留无主坐骑；
 *   Entity.takeDamage 在坐骑吸收时直接 syncView 返回，本体不再结算，等价于气球的载具路由；
 *   坐姿通过 IMonsterAnimController.setRidingPose 单向同步，不在 Tween 回调里改逻辑。
 */

function hit(entity, amount) {
  // harness 用基类 MonsterEntity 构造实体，这里补齐 StagedBodyMonsterEntity 的视图钩子。
  entity.updateBodyDamageStage ??= () => {};
  DolphinRiderEntity.prototype.takeDamage.call(entity, amount);
}

function sync(entity) {
  entity.animController.setRidingPose ??= (value) => { entity.animController.riding = value; };
  DolphinRiderEntity.prototype.syncViewFromModel.call(entity);
}

test("初始状态：坐骑 20 血 + 撑杆跳速度 + 默认优先坐骑", () => {
  resetSim();
  const { model } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  assert.equal(model.mid, 28);
  assert.equal(model.maxHealth, 300);
  assert.equal(model.health, 300);
  assert.equal(model.mountHealth, 20);
  assert.equal(model.mountHealthMax, 20);
  assert.equal(model.mountBroken, false);
  assert.equal(model.hasMount(), true);
  assert.equal(model.mountDamagePriority, "mount");
  assert.equal(model.speed, MonsterSpeed.StickZombie);
  assert.deepEqual(model.habitats, ["water"]);
});

test("优先打坐骑：坐骑破后再打本体", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });

  hit(entity, 5);
  assert.equal(model.mountHealth, 15);
  assert.equal(model.health, 300, "坐骑吸收期间本体不掉血");

  hit(entity, 15);
  assert.equal(model.mountHealth, 0);
  assert.equal(model.mountBroken, true);
  assert.equal(model.hasMount(), false);
  assert.equal(model.speed, MonsterSpeed.Zombie, "坐骑破后恢复普通僵尸速度");

  hit(entity, 10);
  assert.equal(model.health, 290);
});

test("优先打骑乘者：坐骑不受损", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  model.mountDamagePriority = "rider";

  hit(entity, 10);
  assert.equal(model.health, 290);
  assert.equal(model.mountHealth, 20);
  assert.equal(model.mountBroken, false);
  assert.equal(model.hasMount(), true);
});

test("骑乘者死亡：坐骑层一并清空（整体死亡）", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  model.mountDamagePriority = "rider";

  hit(entity, 300);
  assert.equal(model.health, 0);
  assert.equal(model.mountHealth, 0);
  assert.equal(model.mountBroken, true);
});

test("海豚图层使用与木船僵尸一致的锚点/缩放/深度", () => {
  resetSim();
  const { entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  DolphinRiderEntity.prototype.buildView.call(entity);

  const body = entity.attachSprites.get("dolphin_body");
  assert.ok(body, "海豚身体图层已创建");
  const scaleFactor = PositionManager.Instance.scaleFactor;
  assert.equal(body.originY, 1, "与木船相同的底边锚点");
  assert.equal(body.y, entity.y + 15 * scaleFactor, "与木船相同的 y 锚点");
  assert.equal(body.scaleX, scaleFactor * 1.4, "与木船相同的缩放");
});

test("骑乘姿态与海豚图层随坐骑状态单向同步", () => {
  resetSim();
  const { model, entity } = spawnMob(DolphinRiderZombieData, { col: 8, row: 2 });
  entity.attachSprites.set("dolphin_body", { setVisible(v) { this.visible = v; } });
  entity.attachSprites.set("dolphin_tail", { setVisible(v) { this.visible = v; } });
  entity.attachSprites.set("dolphin_fin", { setVisible(v) { this.visible = v; } });

  sync(entity);
  assert.equal(entity.animController.riding, true);
  assert.equal(entity.attachSprites.get("dolphin_body").visible, true);

  model.breakMount();
  sync(entity);
  assert.equal(entity.animController.riding, false);
  assert.equal(entity.attachSprites.get("dolphin_body").visible, false);
});
