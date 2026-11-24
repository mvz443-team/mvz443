import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  spawnMob,
  tick,
  ProjectileCmd,
  getMobsByLane,
  levelValues,
  PositionManager,
} from "../harness/sim.mjs";
import { BouncingAnvilData } from "../../src/game/presets/plant/chapter1/bouncing_anvil.ts";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";

const GRID_X = PositionManager.Instance.GRID_SIZEX;

function putInLane(row, mobs) {
  getMobsByLane().set(row, mobs);
}

/**
 * 描述（bouncing_anvil_description）：
 *   蹦蹦铁砧从种植中心向左右各伸出 1.6 格警戒线；地面、非飞行、非虚空中的
 *   敌人接触警戒线后，铁砧跃起并以该敌人中心为目标中心，300ms 后落地。
 *   落地造成一道不可见的 0.8 格激光，伤害与 TNT 地雷相同；5 级起向左召唤
 *   分身，激光长度扩展为 1.5 格。按倭瓜原型，铁砧落地后碎裂。
 *
 * 星之碎片（不消耗本体）：
 *   从铁砧位置起跳 1–2 道分身，分别落在全场血量最高的两个敌人中心；
 *   悬空 300ms 后落地，每个目标受到 2 次固定 0.8 格、1500 伤害的隐形激光
 *   （可打飞行，不随等级变化）。没有敌人时只出现一道分身，原地起跳并在
 *   300ms 后回到原点，不产生激光。
 *
 * 验收路径：
 *   1) 把真实 ZombieEntity 放入 MobManager.MobsByLane，驱动 Model.onModelStep。
 *   2) 检查警戒线边界、飞行/虚空/睡眠过滤与最近目标选择。
 *   3) tick 300ms，检查 ProjectileCmd.CreateLaser 的起点、长度、伤害与隐形标记。
 *   4) 逐级读取冷却、伤害与激光长度。
 *   5) 直接调用 model.onStarShards，检查目标选择、300ms 落地激光数量与 500ms 复位；
 *      并在普通跃击途中释放星碎，验证普通落地不会销毁本体。
 *
 * 预期结果：
 *   Lv1 冷却 30000ms、伤害 1500、激光长 0.8 格且中心落在目标 x；
 *   Lv5 起激光长 1.5 格并显示分身；Lv9 冷却降至 25500ms；
 *   飞行/虚空/睡眠/超出 1.6 格的目标不触发；
 *   星碎两个目标共 4 发激光（单目标 2 发），无目标 0 发；
 *   Lv1 与 Lv9 的星碎均为 0.8 格 / 1500 伤害，且不销毁本体。
 *
 * 为什么：
 *   onModelStep 扫描 MobsByLane，canTriggerOn 负责阵营、地面、行与 1.6 格判定；
 *   startJump 把目标 x/row 写入 Model 并 schedule 300ms Land；
 *   land 以目标中心反推激光左端点，调用 ProjectileCmd.CreateLaser 后销毁铁砧；
 *   onStarShards 按 currentHealth 降序取前 2 个敌对目标（排除虚空），
 *   schedule 300ms 星碎落地与 500ms 结束；land 在 starShardActive 时取消普通跃击。
 */

test("基础数值：50 能量、30000ms 冷却、1500 伤害", () => {
  resetSim();
  const { model } = spawnPlant(BouncingAnvilData, { level: 1, row: 2 });

  assert.equal(model.pid, 18);
  assert.equal(model.cost.getValueAt(1), 50);
  assert.equal(model.cooldown.getValueAt(1), 30000);
  assert.equal(model.damage.getValueAt(1), 1500);
  assert.equal(model.health, 400);
  assert.equal(model.hasTriggered, false);
  assert.equal(model.isJumping, false);
});

test("警戒线内地面敌人触发，300ms 后以目标中心生成隐形激光", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 1, col: 1, row: 2 });
  const zombie = spawnMob(ZombieData, { col: 2, row: 2 });
  zombie.entity.x = entity.x + GRID_X * 1.6;
  putInLane(2, [zombie.entity]);

  model.onModelStep(entity);

  assert.equal(model.hasTriggered, true);
  assert.equal(model.isJumping, true);
  assert.equal(model.jumpTargetX, zombie.entity.x);
  assert.equal(model.jumpTargetRow, 2);
  assert.equal(model.tickmanager.capture().length, 1);

  tick(sim, 250);
  assert.equal(ProjectileCmd.calls.length, 0);

  tick(sim, 50);
  assert.equal(ProjectileCmd.calls.length, 1);
  const laser = ProjectileCmd.calls[0];
  assert.equal(laser.kind, "laser");
  assert.equal(laser.row, 2);
  assert.equal(laser.cfg.distance, 0.8);
  assert.equal(laser.cfg.damage, 1500);
  assert.equal(laser.cfg.invisible, true);
  // 普通跃击不对空：配置里不声明 flying（默认 false）。
  assert.equal(laser.cfg.flying ?? false, false);
  assert.equal(laser.x, zombie.entity.x - GRID_X * 0.4);
  assert.equal(model.isJumping, false);
  assert.equal(entity.destroyed, true);
});

test("超出警戒线、睡眠、飞行与虚空目标都不触发", () => {
  resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 1, col: 1, row: 2 });
  const zombie = spawnMob(ZombieData, { col: 2, row: 2 });
  putInLane(2, [zombie.entity]);

  zombie.entity.x = entity.x + GRID_X * 1.6 + 1;
  model.onModelStep(entity);
  assert.equal(model.hasTriggered, false);

  zombie.entity.x = entity.x + GRID_X;
  model.isSleeping = true;
  model.onModelStep(entity);
  assert.equal(model.hasTriggered, false);

  model.isSleeping = false;
  zombie.model.flying = true;
  model.onModelStep(entity);
  assert.equal(model.hasTriggered, false);

  zombie.model.flying = false;
  zombie.model.inVoid = true;
  model.onModelStep(entity);
  assert.equal(model.hasTriggered, false);
});

test("多个敌人接触警戒线时选择最近的目标", () => {
  resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 1, col: 1, row: 2 });
  const far = spawnMob(ZombieData, { col: 2, row: 2 });
  const near = spawnMob(ZombieData, { col: 2, row: 2 });
  far.entity.x = entity.x - GRID_X * 0.8;
  near.entity.x = entity.x + GRID_X * 0.4;
  putInLane(2, [far.entity, near.entity]);

  model.onModelStep(entity);

  assert.equal(model.jumpTargetX, near.entity.x);
});

test("Lv5 激光扩展到 1.5 格并显示分身", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 5, col: 1, row: 2 });
  const zombie = spawnMob(ZombieData, { col: 2, row: 2 });
  zombie.entity.x = entity.x + GRID_X;
  putInLane(2, [zombie.entity]);

  assert.equal(model.hasClone, true);
  assert.equal(model.getLaserLength(5), 1.5);
  assert.equal(model.getLaserLength(4), 0.8);

  model.onModelStep(entity);
  tick(sim, 300);

  const laser = ProjectileCmd.calls[0];
  assert.equal(laser.cfg.distance, 1.5);
  assert.equal(laser.x, zombie.entity.x - GRID_X * 0.75);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   冷却从 30000ms 连续递减到 25500ms；伤害固定 1500；
 *   1–4 级激光 0.8 格，5–9 级 1.5 格。
 * 预期结果：下表每一级都必须匹配。
 * 为什么：cooldown / damage 由 LevelScaledValue 定义，
 *   getLaserLength 在 5 级阈值切换长度。
 */
test("Lv1–Lv9 冷却、伤害与激光长度表", () => {
  const cooldowns = levelValues((level) => BouncingAnvilData.cooldown.getValueAt(level));
  assert.equal(cooldowns[0], 30000);
  assert.equal(cooldowns[8], 25500);
  for (let level = 1; level < cooldowns.length; level++) {
    assert.ok(cooldowns[level] < cooldowns[level - 1]);
  }

  assert.deepEqual(
    levelValues((level) => BouncingAnvilData.damage.getValueAt(level)),
    [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500],
  );
  assert.deepEqual(
    levelValues((level) => BouncingAnvilData.getLaserLength(level)),
    [0.8, 0.8, 0.8, 0.8, 1.5, 1.5, 1.5, 1.5, 1.5],
  );
});

test("星之碎片：两道分身攻击血量最高的两个敌人，各造成 2 次 0.8 格伤害", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 1, col: 4, row: 2 });

  const voided = spawnMob(ZombieData, { col: 3, row: 0 });
  voided.entity.currentHealth = 9999;
  voided.model.inVoid = true;
  const first = spawnMob(ZombieData, { col: 3, row: 1 });
  first.entity.currentHealth = 5000;
  const second = spawnMob(ZombieData, { col: 3, row: 3 });
  second.entity.currentHealth = 4000;
  const low = spawnMob(ZombieData, { col: 3, row: 4 });
  low.entity.currentHealth = 1000;
  putInLane(0, [voided.entity]);
  putInLane(1, [first.entity]);
  putInLane(3, [second.entity]);
  putInLane(4, [low.entity]);

  model.onStarShards(entity);

  assert.equal(model.starShardActive, true);
  assert.equal(model.starShardPhase, 1);
  assert.equal(model.starShardHasTarget, true);
  assert.equal(model.starShardTargetCount, 2);
  assert.equal(model.starShardTarget0X, first.entity.x);
  assert.equal(model.starShardTarget0Row, 1);
  assert.equal(model.starShardTarget1X, second.entity.x);
  assert.equal(model.starShardTarget1Row, 3);

  tick(sim, 250);
  assert.equal(ProjectileCmd.calls.length, 0);

  tick(sim, 50);
  assert.equal(model.starShardPhase, 2);
  const lasers = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  assert.equal(lasers.length, 4);
  assert.deepEqual(lasers.map((call) => call.row), [1, 1, 3, 3]);
  for (const laser of lasers) {
    assert.equal(laser.cfg.distance, 0.8);
    assert.equal(laser.cfg.damage, 1500);
    assert.equal(laser.cfg.invisible, true);
    assert.equal(laser.cfg.flying, true);
  }
  assert.equal(lasers[0].x, first.entity.x - GRID_X * 0.4);
  assert.equal(lasers[1].x, first.entity.x - GRID_X * 0.4);
  assert.equal(lasers[2].x, second.entity.x - GRID_X * 0.4);
  assert.equal(lasers[3].x, second.entity.x - GRID_X * 0.4);

  tick(sim, 200);
  assert.equal(model.starShardActive, false);
  assert.equal(model.starShardPhase, 0);
  assert.equal(Boolean(entity.destroyed), false);
  assert.equal(model.hasTriggered, false);
  assert.equal(model.health, 400);
});

test("星之碎片：仅一个敌人时一道分身造成两次伤害", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 1, col: 4, row: 2 });
  const zombie = spawnMob(ZombieData, { col: 3, row: 2 });
  zombie.entity.currentHealth = 5000;
  putInLane(2, [zombie.entity]);

  model.onStarShards(entity);
  assert.equal(model.starShardTargetCount, 1);

  tick(sim, 300);

  const lasers = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  assert.equal(lasers.length, 2);
  for (const laser of lasers) {
    assert.equal(laser.row, 2);
    assert.equal(laser.x, zombie.entity.x - GRID_X * 0.4);
    assert.equal(laser.cfg.distance, 0.8);
    assert.equal(laser.cfg.damage, 1500);
  }
});

test("星之碎片：无敌人时一道分身原地起跳，不产生伤害也不消耗本体", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 1, col: 4, row: 2 });

  model.onStarShards(entity);
  assert.equal(model.starShardActive, true);
  assert.equal(model.starShardHasTarget, false);
  assert.equal(model.starShardTargetCount, 1);

  tick(sim, 300);
  assert.equal(model.starShardPhase, 2);
  assert.equal(ProjectileCmd.calls.length, 0);

  tick(sim, 200);
  assert.equal(model.starShardActive, false);
  assert.equal(model.starShardPhase, 0);
  assert.equal(ProjectileCmd.calls.length, 0);
  assert.equal(Boolean(entity.destroyed), false);
  assert.equal(model.hasTriggered, false);
  assert.equal(model.health, 400);
});

test("星之碎片：飞行目标可被选中并命中", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 1, col: 4, row: 2 });
  const flying = spawnMob(ZombieData, { col: 3, row: 2 });
  flying.entity.currentHealth = 5000;
  flying.model.flying = true;
  putInLane(2, [flying.entity]);

  model.onStarShards(entity);
  tick(sim, 300);

  const lasers = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  assert.equal(lasers.length, 2);
  for (const laser of lasers) {
    assert.equal(laser.row, 2);
    assert.equal(laser.cfg.flying, true);
  }
});

test("星之碎片伤害与长度不随等级变化", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 9, col: 4, row: 2 });
  const first = spawnMob(ZombieData, { col: 3, row: 1 });
  first.entity.currentHealth = 5000;
  const second = spawnMob(ZombieData, { col: 3, row: 3 });
  second.entity.currentHealth = 4000;
  putInLane(1, [first.entity]);
  putInLane(3, [second.entity]);

  assert.equal(model.hasClone, true);
  model.onStarShards(entity);
  tick(sim, 300);

  const lasers = ProjectileCmd.calls.filter((call) => call.kind === "laser");
  assert.equal(lasers.length, 4);
  for (const laser of lasers) {
    assert.equal(laser.cfg.distance, 0.8);
    assert.equal(laser.cfg.damage, 1500);
  }
  assert.equal(lasers[0].x, first.entity.x - GRID_X * 0.4);
  assert.equal(lasers[2].x, second.entity.x - GRID_X * 0.4);
});

test("星之碎片期间普通跃击落地不会销毁铁砧", () => {
  const sim = resetSim();
  const { model, entity } = spawnPlant(BouncingAnvilData, { level: 1, col: 1, row: 2 });
  const zombie = spawnMob(ZombieData, { col: 2, row: 2 });
  zombie.entity.x = entity.x + GRID_X;
  putInLane(2, [zombie.entity]);

  model.onModelStep(entity);
  assert.equal(model.isJumping, true);
  assert.equal(model.hasTriggered, true);

  tick(sim, 100);
  model.onStarShards(entity);
  assert.equal(model.starShardActive, true);

  // 普通跃击原本在 300ms 落地；星碎期间应取消它，不产生普通激光、不销毁本体。
  tick(sim, 200);
  assert.equal(ProjectileCmd.calls.length, 0);
  assert.equal(model.isJumping, false);
  assert.equal(model.hasTriggered, false);
  assert.equal(Boolean(entity.destroyed), false);

  // 星碎在 400ms 落地，单体目标 2 发；600ms 结束。
  tick(sim, 100);
  assert.equal(ProjectileCmd.calls.length, 2);
  assert.equal(model.starShardPhase, 2);

  tick(sim, 200);
  assert.equal(model.starShardActive, false);
  assert.equal(Boolean(entity.destroyed), false);
});
