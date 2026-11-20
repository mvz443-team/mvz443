import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  spawnMob,
  getPlantsMap,
  levelValues,
} from "../harness/sim.mjs";
import { PumpkinPassportData } from "../../src/game/presets/plant/chapter2/pumpkin_passport.ts";
import { DispenserData } from "../../src/game/presets/plant/chapter1/dispenser.ts";
import { LilyData } from "../../src/game/presets/plant/chapter1/lily.ts";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import {
  isShieldPlantPid,
  pickStarShardsTarget,
} from "../../src/game/utils/helper/PlantTargeting.ts";

/**
 * 描述（pumpkin_passport_description）：
 *   南瓜护照是低矮护盾植物：2500 血、125 能量，本身不攻击，低矮（地面子弹打不到）。
 *   同格有其它植物时，护盾先替内部植物承受伤害。
 *   星之碎片：回满生命值并进入尖刺状态；尖刺状态下每次受到近战伤害，
 *   返还一半给伤害源；已经处于尖刺状态时星之碎片只回血。
 *   血量降到一半以下时外壳显示破损（分层前后壁、破损帧与尖刺外露都由 Entity 只读 Model 状态）。
 *
 * 验收路径：
 *   1) spawnPlant 读取基础数值 / tiny / 护盾 pid 表。
 *   2) 先扣血，再调用真实 onStarShards（PlantCmd.SetHealth 走 deferred，用 tick 冲刷）。
 *   3) 直接调用真实 onHurt 传入僵尸 dealer（近战）与投射物 source（远程）。
 *   4) 同格注册「内部植物 + 护照」，对内部植物调用 takeDamage 观察护盾路由。
 *   5) 用真实 PlantTargeting 校验「护照 + 植物 + 睡莲」时星之碎片的目标。
 *   6) 读取 brokenHealthRatio 并校验血量阈值分界。
 *
 * 预期结果：
 *   pid 19 / cost 125 / maxHealth 2500 / tiny = true；
 *   星碎后 health = 2500 且 isSpiky = true；二次星碎只回血、不再播放激活动画；
 *   尖刺下 100 近战伤害 → 僵尸掉 50；非尖刺或带 source 的伤害 → 不返还；
 *   内部植物挨打时护照掉血、内部植物不掉血；护照死亡后内部植物才掉血；
 *   同格「护照 + 植物 + 睡莲」：上半区给内部植物，下半区给护照；只有睡莲时兜底给睡莲；
 *   brokenHealthRatio = 0.5：2500 血时未破损，1250 血起进入破损外观。
 *
 * 为什么：
 *   onStarShards 里 PlantCmd.SetHealth + isSpiky 置位；onHurt 里用
 *   spikeReflectRatio=0.5 且只在 dealer 存在、source 为空时返还；
 *   PlantModel.redirectDamageToShield 通过 PlantTargeting.pickShieldPlant 找同格护照，
 *   pickStarShardsTarget 按「承载物 < 内部植物 < 护盾外壳(aspect=down)」排序；
 *   Entity 的 isShellBroken 用 currentHealth <= maxHealth * brokenHealthRatio 选破损帧。
 */

function plantByPid(plants, pid) {
  return plants.find((plant) => plant.pid === pid);
}

test("基础数值：低矮护盾植物，2500 血 125 能量", () => {
  resetSim();
  const { model } = spawnPlant(PumpkinPassportData, { level: 1, col: 2, row: 2 });

  assert.equal(model.pid, 19);
  assert.equal(model.tiny, true);
  assert.equal(isShieldPlantPid(model.pid), true);
  assert.equal(model.maxHealth.getValueAt(1), 2500);
  assert.equal(model.maxHealth.getValueAt(9), 2500);
  assert.equal(model.cost.getValueAt(1), 125);
  assert.equal(model.cost.getValueAt(9), 125);
  assert.equal(model.isSpiky, false);
  assert.equal(levelValues((lv) => model.cooldown.getValueAt(lv)).length, 9);
});

test("星之碎片回满血量并进入尖刺状态", () => {
  resetSim();
  const { model, entity } = spawnPlant(PumpkinPassportData, { level: 1, col: 2, row: 2 });

  model.health = 400;
  model.onStarShards(entity);

  assert.equal(model.health, 2500);
  assert.equal(model.isSpiky, true);
  assert.equal(entity.viewCalls.includes("playSpikeActivateAnimation"), true);
  assert.equal(entity.viewCalls.includes("syncSpikyView:true"), true);
});

test("已尖刺时星之碎片只回血，不重复激活", () => {
  resetSim();
  const { model, entity } = spawnPlant(PumpkinPassportData, { level: 1, col: 2, row: 2 });

  model.onStarShards(entity);
  const activateCount = entity.viewCalls.filter((call) => call === "playSpikeActivateAnimation").length;

  model.health = 100;
  model.onStarShards(entity);

  assert.equal(model.health, 2500);
  assert.equal(model.isSpiky, true);
  assert.equal(
    entity.viewCalls.filter((call) => call === "playSpikeActivateAnimation").length,
    activateCount,
  );
});

test("尖刺状态把一半近战伤害返还给伤害源", () => {
  resetSim();
  const { model, entity } = spawnPlant(PumpkinPassportData, { level: 1, col: 2, row: 2 });
  const zombie = spawnMob(ZombieData, { col: 2, row: 2 });
  const zombieHealth = zombie.model.health;

  model.onStarShards(entity);

  model.onHurt(entity, 100, 100, zombie.entity);
  assert.equal(zombie.model.health, zombieHealth - 50);

  // 奇数伤害向下取整：75 → 37
  model.onHurt(entity, 75, 75, zombie.entity);
  assert.equal(zombie.model.health, zombieHealth - 50 - 37);
});

test("非尖刺或远程来源的伤害不返还", () => {
  resetSim();
  const { model, entity } = spawnPlant(PumpkinPassportData, { level: 1, col: 2, row: 2 });
  const zombie = spawnMob(ZombieData, { col: 2, row: 2 });
  const zombieHealth = zombie.model.health;

  // 未进入尖刺状态
  model.onHurt(entity, 100, 100, zombie.entity);
  assert.equal(zombie.model.health, zombieHealth);

  model.onStarShards(entity);

  // 带投射物来源（子弹/激光/爆炸）不返还
  model.onHurt(entity, 100, 100, zombie.entity, { model: { hitKind: "bullet" } });
  assert.equal(zombie.model.health, zombieHealth);
});

test("同格护盾植物先承受伤害，护照破碎后内部植物才掉血", () => {
  resetSim();
  const inner = spawnPlant(DispenserData, { level: 1, col: 3, row: 1 });
  const passport = spawnPlant(PumpkinPassportData, { level: 1, col: 3, row: 1 });
  getPlantsMap().set("3-1", [inner.entity, passport.entity]);

  inner.entity.takeDamage(600);

  assert.equal(passport.model.health, 2500 - 600);
  assert.equal(inner.model.health, inner.model.healthMax);
  assert.equal(inner.entity.viewCalls.includes("onHurt"), false);

  // 护照破碎后伤害回落到内部植物
  passport.model.health = 0;
  inner.entity.takeDamage(200);
  assert.equal(inner.model.health, inner.model.healthMax - 200);
});

test("护盾植物自己不会把伤害转给自己", () => {
  resetSim();
  const passport = spawnPlant(PumpkinPassportData, { level: 1, col: 3, row: 1 });
  getPlantsMap().set("3-1", [passport.entity]);

  passport.entity.takeDamage(500);
  assert.equal(passport.model.health, 2000);
});

test("血量降到一半时外壳进入破损外观阈值", () => {
  resetSim();
  const { model } = spawnPlant(PumpkinPassportData, { level: 1, col: 2, row: 2 });

  assert.equal(model.brokenHealthRatio, 0.5);
  const brokenAt = model.healthMax * model.brokenHealthRatio;

  model.health = brokenAt + 1;
  assert.equal(model.health <= brokenAt, false);

  // 只剩一半（含）就破损：1250 血时进入破损帧。
  model.health = brokenAt;
  assert.equal(model.health <= brokenAt, true);
  assert.equal(brokenAt, 1250);
});

test("护照 + 植物 + 睡莲：上半区给内部植物，下半区给护照", () => {
  const passport = { pid: 19, currentHealth: 2500 };
  const inner = { pid: 1, currentHealth: 300 };
  const lily = { pid: 6, currentHealth: 300 };
  const cell = [lily, inner, passport];

  assert.equal(pickStarShardsTarget(cell, "up"), inner);
  assert.equal(pickStarShardsTarget(cell, "down"), passport);
});

test("承载物永远不是默认目标；只剩承载物时兜底", () => {
  const inner = { pid: 1, currentHealth: 300 };
  const lily = { pid: 6, currentHealth: 300 };

  assert.equal(pickStarShardsTarget([lily, inner], "up"), inner);
  assert.equal(pickStarShardsTarget([lily, inner], "down"), inner);
  assert.equal(pickStarShardsTarget([lily], "up"), lily);

  // 护照 + 睡莲（没有内部植物）：上半区给承载物，下半区给护照
  const passport = { pid: 19, currentHealth: 2500 };
  assert.equal(pickStarShardsTarget([lily, passport], "up"), lily);
  assert.equal(pickStarShardsTarget([lily, passport], "down"), passport);

  // 只有护照
  assert.equal(pickStarShardsTarget([passport], "up"), passport);
  // 全灭 / 空
  assert.equal(pickStarShardsTarget([{ pid: 1, currentHealth: 0 }], "up"), null);
  assert.equal(pickStarShardsTarget([], "down"), null);
});

test("睡莲 + 内部植物 + 护照时的铲除优先级不受星碎规则影响", () => {
  resetSim();
  const lily = spawnPlant(LilyData, { level: 1, col: 4, row: 4 });
  const inner = spawnPlant(DispenserData, { level: 1, col: 4, row: 4 });
  const passport = spawnPlant(PumpkinPassportData, { level: 1, col: 4, row: 4 });
  getPlantsMap().set("4-4", [lily.entity, inner.entity, passport.entity]);

  const plants = getPlantsMap().get("4-4");
  assert.equal(plantByPid(plants, 19), passport.entity);
  assert.equal(pickStarShardsTarget(plants, "up"), inner.entity);
  assert.equal(pickStarShardsTarget(plants, "down"), passport.entity);
});
