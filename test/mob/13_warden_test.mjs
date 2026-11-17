import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnMob,
  tick,
  MobCmd,
  ProjectileCmd,
} from "../harness/sim.mjs";
import { WardenData } from "../../src/game/presets/monster/golem/warden.ts";

/**
 * 描述（Warden）：
 *   监守者技能 1 发射 1000 伤害、13 格、3.5s 的激光；
 *   技能 2 高跳后落地，对 1 格范围造成 180 伤害并召唤矿工/钢盔矿工（mid=4/5）；
 *   每轮结束后钻地重新出现在 3 或 8 列。
 *
 * 验收路径：
 *   1) 直接调用 skill1，检查 CreateLaser 配置。
 *   2) 直接调用 skill2，推进 1000ms 检查 DamagePlantsArea 与两次 Spawn。
 *   3) 调用 beginReposition，推进 1600ms 检查列号。
 *   4) 完整轮次：2500ms Begin → 4000ms 后 skill2 → 1000ms 后落地。
 *
 * 预期结果：
 *   激光 damage=1000、distance=13、duration=3500；
 *   落地 damageArea=180、spawn mid 4/5 于自身格；
 *   重定位 col 为 3 或 8。
 *
 * 为什么：
 *   WardenModel.skill1/skill2 固定这些数值；
 *   onWardenLand 调 MobCmd.DamagePlantsArea(col,row,1,1,180) 并 Spawn(4/5)；
 *   beginReposition 用 random>0.5 选 8/3，1600ms 后应用。
 */

test("skill1 发射 1000 伤害、13 格激光", () => {
  resetSim();
  const { model, entity } = spawnMob(WardenData, { col: 8, row: 2 });

  model.skill1(entity);
  assert.equal(ProjectileCmd.calls.length, 1);
  const laser = ProjectileCmd.calls[0];
  assert.equal(laser.kind, "laser");
  assert.equal(laser.cfg.damage, 1000);
  assert.equal(laser.cfg.distance, 13);
  assert.equal(laser.cfg.duration, 3500);
});

test("skill2 落地造成 180 范围伤害并召唤 4/5", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(WardenData, { col: 8, row: 2 });

  model.skill2(entity);
  assert.equal(entity.viewCalls.includes("wardenHighJump"), true);
  tick(sim, 1_000);

  const area = MobCmd.calls.find((call) => call.kind === "damageArea");
  assert.deepEqual(
    [area.centerCol, area.centerRow, area.radiusX, area.radiusY, area.damage],
    [8, 2, 1, 1, 180],
  );
  const spawns = MobCmd.calls.filter((call) => call.kind === "spawn");
  assert.deepEqual(spawns.map((call) => [call.mid, call.col, call.row]), [[4, 8, 2], [5, 8, 2]]);
});

test("重定位只落在 3 或 8 列", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(WardenData, { col: 8, row: 2 });

  model.beginReposition(entity, () => {});
  tick(sim, 1_600);

  assert.equal([3, 8].includes(entity.col), true);
  assert.equal(entity.row >= 0 && entity.row <= 4, true);
  assert.equal(entity.viewCalls.includes("wardenReposition"), true);
});

test("完整轮次在 6500ms 施放 skill2，7500ms 落地", () => {
  const sim = resetSim();
  spawnMob(WardenData, { col: 8, row: 2 });

  tick(sim, 6_500);
  assert.equal(MobCmd.calls.filter((call) => call.kind === "damageArea").length, 0);

  tick(sim, 1_000);
  assert.equal(MobCmd.calls.filter((call) => call.kind === "damageArea").length, 1);
});
