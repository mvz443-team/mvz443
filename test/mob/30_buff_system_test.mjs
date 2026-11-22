import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, tick, ProjectileCmd } from "../harness/sim.mjs";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { SkeletonBowData } from "../../src/game/presets/monster/zombie/skeleton_bow.ts";
import { WardenData } from "../../src/game/presets/monster/golem/warden.ts";
import {
  snapshotModel,
  restoreModel,
} from "../../src/game/core/logic/LogicModel.ts";

/**
 * 描述（BuffSystem）：
 *   三种 buff：slow（移速/攻速/动画减半）、frozen（停攻停移并重置攻击计时器）、
 *   berserk（移速/攻速/动画加倍）；仅对 golem / centipede 系列无效（与 rank 无关）。
 *   幂等：同一 buff 多次施加取剩余时间最长；三种默认可共存。
 *   frozen 结束立即链式获得 5s slow；施加时长必须有界不可永久。
 *
 * 验收路径：
 *   1) applyBuff('slow', 5000) 检查 speedMultiplier=0.5、动画倍率、远程间隔翻倍。
 *   2) applyBuff('frozen', 2000) 检查 isFrozen、无攻击/射箭、2s 后转 slow 5s。
 *   3) applyBuff('berserk', 900000) 检查倍率×2、有界时长。
 *   4) 幂等：短时长不能覆盖长时长；多次施加后剩余时间取最大。
 *   5) 共存：三者可同时存在；clearBuff 只清指定项。
 *   6) golem/centipede（buffImmune=true）拒绝所有 buff；普通怪可被施加。
 *   7) 快照/回滚：buff 状态进快照，回滚后恢复。
 *
 * 预期结果：
 *   slow: speedMultiplier=0.5、attackIntervalMultiplier=2、动画=0.5、弓手 7000ms 一发；
 *   frozen: isFrozen=true、2s 内 0 次攻击、到期后 hasBuff('slow') 且剩约 5000ms；
 *   berserk: speedMultiplier=2、attackIntervalMultiplier=0.5；
 *   幂等：先 5000 再 1000 仍约 5000ms；精英/首领 applyBuff 返回 false。
 *
 * 为什么：
 *   MonsterModel.applyBuff 用 untilFrame=currentFrame+ceil(ms/interval)，取 max 保证幂等；
 *   getBuffLeftMs 基于帧号；onBuffExpired 在 frozen 到期调 applyBuff('slow',5000)；
 *   免疫由 definition.buffImmune 决定；倍率全部是派生 getter，不改 speed 字段。
 */

function makeSim(seed = 20261117) {
  return resetSim({ rows: 5, cols: 9, seed });
}

test("slow：移速/攻速/动画倍率减半，远程间隔翻倍", () => {
  const sim = makeSim();
  const { model, entity } = spawnMob(SkeletonBowData, { col: 8, row: 2, sightTarget: true });

  assert.equal(model.speedMultiplier, 1);
  // 时长需覆盖翻倍后的 7000ms 射击间隔，否则射击前 buff 过期会重建 timer。
  assert.equal(model.applyBuff("slow", 8_000), true);
  assert.equal(model.hasBuff("slow"), true);
  assert.equal(model.speedMultiplier, 0.5);
  assert.equal(model.attackIntervalMultiplier, 2);
  assert.equal(model.motionSpeedScale, 0.5);
  assert.equal(model.effectiveArrowInterval, SkeletonBowData.definition.arrowInterval * 2);

  // 视图同步把倍率传给动画控制器。
  entity.syncViewFromModel();
  assert.equal(entity.animController.motionSpeedScale, 0.5);

  // 3500ms 原始间隔翻倍到 7000ms：3500ms 时尚未射击。
  tick(sim, 3_500);
  assert.equal(ProjectileCmd.calls.length, 0);
  tick(sim, 3_500);
  assert.equal(ProjectileCmd.calls.length, 1);
});

test("frozen：停攻停移，到期立即链式获得 5s slow", () => {
  const sim = makeSim();
  const { model } = spawnMob(SkeletonBowData, { col: 8, row: 2, sightTarget: true });

  assert.equal(model.applyBuff("frozen", 2000), true);
  assert.equal(model.isFrozen, true);
  assert.equal(model.hasBuff("frozen"), true);

  tick(sim, 2_000);
  // frozen 到期：isFrozen 复位，立刻附带 slow 5s。
  assert.equal(model.isFrozen, false);
  assert.equal(model.hasBuff("frozen"), false);
  assert.equal(model.hasBuff("slow"), true);
  const left = model.getBuffLeftMs("slow");
  assert.ok(left > 4_000 && left <= 5_000, `slow 剩余 ${left}ms`);

  // 冻结期间重置了射击计时器；到期后按新（slow）间隔 7000ms 才射击。
  assert.equal(ProjectileCmd.calls.length, 0);
});

test("berserk：移速/攻速/动画倍率加倍且时长有界", () => {
  makeSim();
  const { model } = spawnMob(ZombieData, { col: 8, row: 2 });

  assert.equal(model.applyBuff("berserk", 900_000), true);
  assert.equal(model.speedMultiplier, 2);
  assert.equal(model.attackIntervalMultiplier, 0.5);
  assert.equal(model.motionSpeedScale, 2);
  assert.ok(model.getBuffLeftMs("berserk") > 0);
  assert.ok(model.getBuffLeftMs("berserk") <= 900_000);
});

test("幂等：多次施加同一 buff 取剩余时间最长", () => {
  const sim = makeSim();
  const { model } = spawnMob(ZombieData, { col: 8, row: 2 });

  model.applyBuff("slow", 5_000);
  const longLeft = model.getBuffLeftMs("slow");
  tick(sim, 1_000);
  const before = model.getBuffLeftMs("slow");
  assert.ok(before < longLeft);

  // 更短的时长不能覆盖更长的剩余时间。
  assert.equal(model.applyBuff("slow", 1_000), false);
  assert.equal(model.getBuffLeftMs("slow"), before);

  // 更长的时长可以延长。
  assert.equal(model.applyBuff("slow", 8_000), true);
  assert.ok(model.getBuffLeftMs("slow") > before);
});

test("共存：三种 buff 可同时存在，clearBuff 只清指定项", () => {
  makeSim();
  const { model } = spawnMob(ZombieData, { col: 8, row: 2 });

  model.applyBuff("slow", 5_000);
  model.applyBuff("frozen", 2_000);
  model.applyBuff("berserk", 900_000);
  assert.equal(model.hasBuff("slow"), true);
  assert.equal(model.hasBuff("frozen"), true);
  assert.equal(model.hasBuff("berserk"), true);

  model.clearBuff("frozen");
  assert.equal(model.hasBuff("frozen"), false);
  assert.equal(model.hasBuff("slow"), true);
  assert.equal(model.hasBuff("berserk"), true);
});

test("golem / centipede 免疫 buff（与 rank 无关）", () => {
  makeSim();
  // warden 是 golem 系列且 buffImmune=true（rank=elite）；普通僵尸 rank=normal 但应可被施加。
  const { model: golem } = spawnMob(WardenData, { col: 8, row: 2 });
  assert.equal(golem.isBuffImmune, true);
  assert.equal(golem.applyBuff("slow", 5_000), false);
  assert.equal(golem.applyBuff("frozen", 2_000), false);
  assert.equal(golem.applyBuff("berserk", 900_000), false);
  assert.equal(golem.hasBuff("slow"), false);
  assert.equal(golem.hasBuff("frozen"), false);
  assert.equal(golem.hasBuff("berserk"), false);
  assert.equal(golem.speedMultiplier, 1);

  // 普通怪（非 golem/centipede）必须能被施加，验证免疫不是按 rank。
  const { model: normal } = spawnMob(ZombieData, { col: 7, row: 2 });
  assert.equal(normal.isBuffImmune, false);
  assert.equal(normal.applyBuff("slow", 5_000), true);
  assert.equal(normal.hasBuff("slow"), true);
});

test("buff 状态进快照，回滚后恢复", () => {
  const sim = makeSim();
  const { model } = spawnMob(ZombieData, { col: 8, row: 2 });
  model.applyBuff("slow", 5_000);
  const before = snapshotModel(model);
  const untilFrameBefore = model.buffSlowUntilFrame;

  tick(sim, 1_000);
  assert.ok(model.getBuffLeftMs("slow") < 5_000);

  // 只回滚 Model 字段（完整快照还会 setFrame/恢复 timer，这里只验证字段进快照）。
  restoreModel(model, before);
  assert.equal(model.buffSlowUntilFrame, untilFrameBefore);
  assert.equal(model.hasBuff("slow"), true);
});
