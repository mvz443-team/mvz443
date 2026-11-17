import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnMob,
  tick,
  MobCmd,
  ObstacleCmd,
} from "../harness/sim.mjs";
import { ObsidianGolemData } from "../../src/game/presets/monster/golem/golem_obsidian.ts";

/**
 * 描述（ObsidianGolem）：
 *   黑曜石傀儡每轮先召唤小怪，再交替使用岩柱与守卫技能；
 *   岩柱在 800ms 间隔后落下，1.2s 后生成 300 血黑曜石障碍并秒杀半血植物；
 *   守卫技能在自身及上下行生成 500 血障碍并召唤盾卫（mid=11）。
 *
 * 验收路径：
 *   1) 推进 2500ms 触发 GolemBegin，统计召唤批次。
 *   2) 直接调用 skill1，按 800/1200ms 推进，检查 ObstacleCmd。
 *   3) 直接调用 skill2，检查 3 个 500 血障碍与 3 个 mid=11。
 *   4) 调用 beginReposition 并推进 1200ms，检查行号变化。
 *
 * 预期结果：
 *   Begin 后 pendingSpawns 清空、callCount=1、生成 3 个 allowed mid；
 *   5 行时 skill1 选择 0/2/4 行，最终 3 个 hp=300、col=8 的障碍；
 *   skill2 在 col=6 生成 3 个 hp=500 障碍，并在 col=7 召唤 3 个 mid=11；
 *   Reposition 后 row 落在 0..4。
 *
 * 为什么：
 *   GolemModel.Begin 先 runCycle 再 callMob；ObsidianGolemModel.skill1
 *   对奇数行数使用 0,2,4；spawnColumn 固定 1200ms 后 ObstacleSpawn；
 *   skill2 遍历自身/上下行调用 spawnColumn(6,...,500) 与 Spawn(11,7,...)。
 */

test("2500ms 进入 GolemBegin 并召唤首批小怪", () => {
  const sim = resetSim();
  const { model } = spawnMob(ObsidianGolemData, { col: 8, row: 2 });

  tick(sim, 2_500);

  const spawns = MobCmd.calls.filter((call) => call.kind === "spawn");
  assert.equal(spawns.length, 3);
  assert.equal(model.callCount, 1);
  assert.deepEqual(model.pendingSpawns, []);
});

test("skill1 对 0/2/4 行生成 300 血黑曜石障碍", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ObsidianGolemData, { col: 8, row: 2 });

  model.skill1(entity);
  tick(sim, 2_000);

  const obstacles = ObstacleCmd.calls;
  assert.equal(obstacles.length, 1);
  assert.equal(obstacles[0].oid, 1);
  assert.equal(obstacles[0].col, 8);
  assert.equal(obstacles[0].row, 0);
  assert.equal(obstacles[0].config.hp, 300);

  tick(sim, 1_200);
  assert.equal(ObstacleCmd.calls.length, 3);
  assert.deepEqual(ObstacleCmd.calls.map((call) => call.row), [0, 2, 4]);
});

test("skill2 生成 500 血障碍并召唤 3 个盾卫", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ObsidianGolemData, { col: 8, row: 2 });

  model.skill2(entity);
  tick(sim, 1_200);

  assert.equal(ObstacleCmd.calls.length, 3);
  assert.deepEqual(ObstacleCmd.calls.map((call) => call.row), [2, 1, 3]);
  for (const call of ObstacleCmd.calls) {
    assert.equal(call.col, 6);
    assert.equal(call.config.hp, 500);
  }
  const guards = MobCmd.calls.filter((call) => call.kind === "spawn" && call.mid === 11);
  assert.equal(guards.length, 3);
  assert.deepEqual(guards.map((call) => [call.col, call.row]), [[7, 2], [7, 1], [7, 3]]);
});

test("Reposition 后移动到新的合法行", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(ObsidianGolemData, { col: 8, row: 2 });

  model.beginReposition(entity);
  tick(sim, 1_200);

  assert.equal(entity.col, 8);
  assert.equal(entity.row >= 0 && entity.row <= 4, true);
  assert.equal(entity.viewCalls.includes("obsidianReposition"), true);
});

test("完整轮次先 Begin，再在 7000ms 后施放 skill2", () => {
  const sim = resetSim();
  spawnMob(ObsidianGolemData, { col: 8, row: 2 });

  tick(sim, 9_500);

  const guards = MobCmd.calls.filter((call) => call.kind === "spawn" && call.mid === 11);
  assert.equal(guards.length, 3);
});
