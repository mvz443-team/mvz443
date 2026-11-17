import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, tick, ProjectileCmd } from "../harness/sim.mjs";
import { SkeletonBowData } from "../../src/game/presets/monster/zombie/skeleton_bow.ts";

/**
 * 描述（SkeletonBow）：
 *   骷髅弓手每 3500ms 检查一次前方视线，有目标时发射 70 伤害的箭；
 *   射击后进入 350ms 的收招，随后恢复移动。
 *
 * 验收路径：
 *   1) 无视线目标推进 4s，不应有箭。
 *   2) 有目标推进 3500ms，检查箭的伤害/速度/阵营。
 *   3) 再推进 350ms，检查武器停止挥动并恢复移动。
 *   4) 推进到 7000ms 检查第二发。
 *
 * 预期结果：
 *   无目标 0 发；3500ms 第 1 发，伤害 70、速度 <0、阵营 ZOMBIE；
 *   3850ms 时 weaponSwinging=false 且 moveCalls 包含 start；7000ms 第 2 发。
 *
 * 为什么：
 *   onCreate 用 schedule(Shoot, 3500, {loop:true})；
 *   tryShoot 检查 hasSightTarget 后创建 ArrowModel，并 schedule(Resume,350)；
 *   Resume 分支调用 onAttackStopped 并 startMove。
 */

test("无视线目标时不射箭", () => {
  const sim = resetSim();
  spawnMob(SkeletonBowData, { col: 8, row: 2, sightTarget: false });

  tick(sim, 4_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

test("3500ms 射出 70 伤害的箭，350ms 后恢复移动", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(SkeletonBowData, { col: 8, row: 2, sightTarget: true });

  tick(sim, 3_500);
  assert.equal(ProjectileCmd.calls.length, 1);
  const arrow = ProjectileCmd.calls[0];
  assert.equal(arrow.model, "ArrowModel");
  assert.equal(arrow.cfg.damage, 70);
  assert.equal(arrow.cfg.speed < 0, true);
  assert.equal(arrow.cfg.faction, 2);
  assert.equal(model.weaponSwinging, true);

  tick(sim, 350);
  assert.equal(model.weaponSwinging, false);
  assert.equal(entity.moveCalls.includes("start"), true);

  tick(sim, 3_500);
  assert.equal(ProjectileCmd.calls.length, 2);
});

test("冻结时不射箭", () => {
  const sim = resetSim();
  const { model } = spawnMob(SkeletonBowData, { col: 8, row: 2, sightTarget: true });
  model.isFrozen = true;

  tick(sim, 4_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});
