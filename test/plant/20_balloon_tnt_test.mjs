import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  spawnMob,
  tick,
  getMobsByLane,
  MobCmd,
  ProjectileCmd,
  levelValues,
} from "../harness/sim.mjs";
import { BalloonTntData, BALLOON_TNT_STAGE } from "../../src/game/presets/plant/chapter2/balloon_tnt.ts";
import {
  BalloonTntCloneData,
  BALLOON_TNT_CLONE_MID,
} from "../../src/game/presets/monster/summon/balloon_tnt_clone.ts";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { PositionManager } from "../harness/sim.mjs";

/**
 * 描述（balloon_tnt_description）：
 *   低矮器械，450 血、125 能量、14 秒冷却、不响应任何碰撞。
 *   充气分三档：0 瘪气 → 1 半鼓（充气时间一半）→ 2 充满并垂直升空（解除低矮）。
 *   6 秒充满，Lv5 起 3 秒。升空后只被飞行怪物引爆，3x3 爆炸、伤害 350（Lv9 400）。
 *   星之碎片：立即充满，并派出一枚向右飞行的气球TNT分身（200 血），
 *   碰到第一个怪物或刚进入移动方向上的最后一格时以本体伤害爆炸。
 *
 * 验收路径：
 *   1) spawnPlant 后读取数值、tiny、inflateStage。
 *   2) tick 到 3000/6000ms 观察阶段与 tiny 变化；Lv5 用 1500/3000ms。
 *   3) 直接调用实体 onCollision / 模型 checkAirborneCollisionOnce 观察爆炸与销毁。
 *   4) 直接调用 onStarShards，检查 MobCmd.Spawn 的 mid 与伤害回写。
 *   5) 单独 spawnMob(BalloonTntCloneData) 验证分身向右飞、200 血、不索敌、
 *      刚进入最后一格即爆炸，并反转 speed 验证判定跟随方向。
 *
 * 预期结果：
 *   pid 20 / cost 125 / maxHealth 450 / damage 350（Lv9 400）/ cooldown 14000；
 *   初始 stage=0 且 tiny=true；3s 后 stage=1；6s 后 stage=2 且 tiny=false；
 *   地面僵尸碰撞不爆炸，飞行僵尸碰撞触发一次 3x3 爆炸并销毁本体；
 *   充满瞬间已在格内的飞行僵尸由一次性补判引爆；
 *   星碎后 stage=2 且 Spawn 参数为 (21, waveID=-10)，回写 explosionDamage=350；
 *   分身 speed 为负（startMove 后向右）、canStartAttack 恒 false、
 *   刚踏进最右列左边界即爆炸（不是格子中心），反转后按 col 0 右边界判定。
 *
 * 为什么：
 *   onCreate 用 tickmanager 排 Half(duration/2)/Full(duration)；
 *   applyStage 在 Airborne 时把 tiny 置 false；onModelStep 只在 Airborne 且
 *   readBodyLayers(target).flying 时调用 explode（hasExploded 防重复）；
 *   clone 的 initializeState 把 speed 取负以复用 MonsterEntity.startMove 的 -speed。
 */

function putInLane(row, mobs) {
  getMobsByLane().set(row, mobs);
}

test("基础数值：低矮器械 450 血 125 能量 14 秒冷却", () => {
  resetSim();
  const { model } = spawnPlant(BalloonTntData, { level: 1, col: 3, row: 1 });

  assert.equal(model.pid, 20);
  assert.equal(model.maxHealth.getValueAt(1), 450);
  assert.equal(model.cost.getValueAt(1), 125);
  assert.equal(model.damage.getValueAt(1), 350);
  assert.equal(model.damage.getValueAt(8), 350);
  assert.equal(model.damage.getValueAt(9), 400);
  assert.equal(model.cooldown.getValueAt(1), 14000);
  assert.equal(model.tiny, true);
  assert.equal(model.inflateStage, BALLOON_TNT_STAGE.Deflated);
  assert.equal(levelValues((lv) => model.cooldown.getValueAt(lv)).length, 9);
});

test("充气三档：3 秒半鼓、6 秒充满并解除低矮", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BalloonTntData, { level: 1, col: 3, row: 1 });

  tick(sim, 2950);
  assert.equal(model.inflateStage, BALLOON_TNT_STAGE.Deflated);

  tick(sim, 100);
  assert.equal(model.inflateStage, BALLOON_TNT_STAGE.Half);
  assert.equal(model.tiny, true);

  tick(sim, 3000);
  assert.equal(model.inflateStage, BALLOON_TNT_STAGE.Airborne);
  assert.equal(model.tiny, false);
  assert.equal(entity.viewCalls.filter((call) => call === "syncInflateView").length >= 2, true);
});

test("Lv5 起充气时间缩短到 3 秒", () => {
  const sim = resetSim();
  const { model } = spawnPlant(BalloonTntData, { level: 5, col: 3, row: 1 });

  assert.equal(model.getInflateDuration(1), 6000);
  assert.equal(model.getInflateDuration(4), 6000);
  assert.equal(model.getInflateDuration(5), 3000);

  tick(sim, 1550);
  assert.equal(model.inflateStage, BALLOON_TNT_STAGE.Half);

  tick(sim, 1500);
  assert.equal(model.inflateStage, BALLOON_TNT_STAGE.Airborne);
});

test("充气未完成时飞行怪物碰撞也不引爆", () => {
  resetSim();
  const { model, entity } = spawnPlant(BalloonTntData, { level: 1, col: 3, row: 1 });
  const zombie = spawnMob(ZombieData, { col: 3, row: 1 });
  zombie.model.flying = true;
  putInLane(1, [zombie.entity]);

  entity.onCollision({ targetEntity: zombie.entity });
  assert.equal(model.hasExploded, false);
  assert.equal(ProjectileCmd.calls.filter((call) => call.kind === "explosion").length, 0);
});

test("升空后只被飞行怪物碰撞引爆，地面僵尸碰撞不触发", () => {
  resetSim();
  const { model, entity } = spawnPlant(BalloonTntData, { level: 1, col: 3, row: 1 });
  const zombie = spawnMob(ZombieData, { col: 3, row: 1 });

  // 充气阶段：碰撞被忽略
  entity.onCollision({ targetEntity: zombie.entity });
  assert.equal(model.hasExploded, false);

  model.completeInflation();
  // 地面僵尸：不引爆
  entity.onCollision({ targetEntity: zombie.entity });
  assert.equal(model.hasExploded, false);

  // 飞行怪物：碰撞即引爆
  zombie.model.flying = true;
  entity.onCollision({ targetEntity: zombie.entity });

  assert.equal(model.hasExploded, true);
  const explosions = ProjectileCmd.calls.filter((call) => call.kind === "explosion");
  assert.equal(explosions.length, 1);
  assert.equal(explosions[0].cfg.damage, 350);
  assert.equal(explosions[0].cfg.leftGrid, 1.5);
  assert.equal(explosions[0].cfg.rightGrid, 1.5);
  assert.equal(explosions[0].cfg.upGrid, 1);
  assert.equal(explosions[0].row, 1);

  // 一次性：再次碰撞不会二次爆炸
  entity.onCollision({ targetEntity: zombie.entity });
  assert.equal(ProjectileCmd.calls.filter((call) => call.kind === "explosion").length, 1);
});

test("充满瞬间补判一次：已在格内的飞行僵尸被引爆", () => {
  resetSim();
  const { model, entity } = spawnPlant(BalloonTntData, { level: 1, col: 3, row: 1 });
  const zombie = spawnMob(ZombieData, { col: 3, row: 1 });
  zombie.model.flying = true;
  putInLane(1, [zombie.entity]);

  model.completeInflation();

  const explosions = ProjectileCmd.calls.filter((call) => call.kind === "explosion");
  assert.equal(explosions.length, 1);
  assert.equal(model.hasExploded, true);

  // 补判只做一次，不会每帧触发
  model.checkAirborneCollisionOnce(entity);
  assert.equal(ProjectileCmd.calls.filter((call) => call.kind === "explosion").length, 1);
});

test("星之碎片立即充满并召唤向右飞行的分身", () => {
  resetSim();
  const { model, entity } = spawnPlant(BalloonTntData, { level: 9, col: 3, row: 1 });

  model.onStarShards(entity);

  assert.equal(model.inflateStage, BALLOON_TNT_STAGE.Airborne);
  assert.equal(model.tiny, false);

  const spawn = MobCmd.calls.find((call) => call.kind === "spawn");
  assert.equal(spawn.mid, BALLOON_TNT_CLONE_MID);
  assert.equal(spawn.waveID, -10);
  assert.equal(typeof spawn.callback, "function");

  // 回调把本体等级伤害写进分身 Model
  const cloneModel = BalloonTntCloneData.clone();
  spawn.callback({ model: cloneModel });
  assert.equal(cloneModel.explosionDamage, 400);
});

test("分身：200 血、向右飞、不索敌、刚进入最右列即爆炸", () => {
  resetSim();
  const clone = spawnMob(BalloonTntCloneData, { col: 2, row: 1 });

  assert.equal(clone.model.maxHealth, 200);
  assert.equal(clone.model.health, 200);
  assert.equal(clone.model.faction, 1); // Faction.PLANT
  assert.equal(clone.model.flying, true);
  assert.equal(clone.model.speed < 0, true);
  assert.equal(clone.model.canStartAttack({ faction: 2, currentHealth: 100 }), false);

  // 未到最右列不爆炸
  clone.model.onModelStep(clone.entity);
  assert.equal(ProjectileCmd.calls.filter((call) => call.kind === "explosion").length, 0);

  const lastCol = PositionManager.Instance.Col_Number - 1;
  const lastColLeft = PositionManager.Instance.getGridTopLeft(lastCol, 1).x;

  // 还在倒数第二列：不爆炸。
  clone.entity.x = lastColLeft - 1;
  clone.model.onModelStep(clone.entity);
  assert.equal(ProjectileCmd.calls.filter((call) => call.kind === "explosion").length, 0);

  // 刚踏进最右列左边界：立即爆炸（不等走到格子中心）。
  clone.entity.x = lastColLeft;
  clone.model.onModelStep(clone.entity);
  const explosions = ProjectileCmd.calls.filter((call) => call.kind === "explosion");
  assert.equal(explosions.length, 1);
  assert.equal(explosions[0].cfg.damage, clone.model.explosionDamage);
});

test("分身移动方向反转后，最后一格判定跟随 speed 而不是硬编码最右列", () => {
  resetSim();
  const clone = spawnMob(BalloonTntCloneData, { col: 4, row: 1 });

  // 向左飞：speed 取正，最后一格变成 col 0。
  clone.model.speed = Math.abs(clone.model.speed);

  // 最右列不触发。
  const lastCol = PositionManager.Instance.Col_Number - 1;
  clone.entity.x = PositionManager.Instance.getGridTopLeft(lastCol, 1).x;
  clone.model.onModelStep(clone.entity);
  assert.equal(ProjectileCmd.calls.filter((call) => call.kind === "explosion").length, 0);

  // 刚进入 col 0 右边界即触发。
  clone.entity.x = PositionManager.Instance.getGridTopLeft(0, 1).x
    + PositionManager.Instance.GRID_SIZEX;
  clone.model.onModelStep(clone.entity);
  assert.equal(ProjectileCmd.calls.filter((call) => call.kind === "explosion").length, 1);
});

test("分身碰到第一个僵尸立即爆炸（碰撞事件）", () => {
  resetSim();
  const clone = spawnMob(BalloonTntCloneData, { col: 2, row: 1 });
  const zombie = spawnMob(ZombieData, { col: 2, row: 1 });

  clone.entity.onCollision({ targetEntity: zombie.entity });

  const explosions = ProjectileCmd.calls.filter((call) => call.kind === "explosion");
  assert.equal(explosions.length, 1);
  assert.equal(clone.model.hasExploded, true);
});
