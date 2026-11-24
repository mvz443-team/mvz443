import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  applyInstantPlant,
  tick,
  ProjectileCmd,
  ResourceCmd,
  SfxCmd,
  getPlantsMap,
  levelValues,
} from "../harness/sim.mjs";
import { MagicPowderData } from "../../src/game/presets/plant/chapter1/magic_powder.ts";

/**
 * 描述（magic_powder_description）：
 *   魔法粉是一次性瞬发植物：种植落地的同一确定性帧发射一次近距离激光并额外获得 1 星之碎片；
 *   不创建 Entity、物理体，也没有 300ms 存活时间。9 级激光伤害提升到 2000。
 *
 * 验收路径：
 *   直接驱动真实 applyInstantEffect；检查 ProjectileCmd / ResourceCmd / SfxCmd 调用与 PlantsMap 是否为空。
 *
 * 预期结果：
 *   Lv1 1 条激光伤害 1500、distance 1.2；+1 星碎；不产生任何植物实体；
 *   额外产生 1 个 GainStarShardSfx，起点与粉末散播特效相同（当前放置格子）；
 *   Lv9 伤害 2000；onStarShards 仍无额外效果。
 *
 * 为什么：
 *   applyInstantEffect 内 CreateLaser，damage = LevelScaledValue(1500).setThreshold(9, 2000)，
 *   并调用 AddStarshardToAll(1)；PlantsManager 对 isOneTimePlant 直接走该入口，不 createEntity；
 *   GainStarShardSfx 只经 SfxCmd.Create 创建，不调用 ResourceCmd / UpdateStarShards，也不进快照。
 */

test("Lv1 落地立即发射 1500 伤害激光并 +1 星碎（延迟到账），且不创建实体", () => {
  const sim = resetSim();
  applyInstantPlant(MagicPowderData, { level: 1 });

  assert.equal(ProjectileCmd.calls.length, 1);
  assert.equal(ProjectileCmd.calls[0].kind, "laser");
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 1500);
  assert.equal(ProjectileCmd.calls[0].cfg.distance, 1.2);
  assert.deepEqual(ResourceCmd.calls, [], "星碎到账应延迟，不立即发生");
  assert.equal(ResourceCmd.anims.length, 1, "应立即播星碎动画");
  assert.equal(getPlantsMap().size, 0, "一次性植物不进入 PlantsMap");

  const dropSfx = SfxCmd.calls.find((call) => call.name === "GainStarShardSfx");
  const scatterSfx = SfxCmd.calls.find((call) => call.name === "PowderScatterSfx");
  assert.ok(dropSfx, "应产生纯视觉星屑掉落物");
  assert.equal(dropSfx.args.amount, 1);
  assert.equal(dropSfx.args.x, scatterSfx.args.x, "掉落起点为当前放置格子");
  assert.equal(dropSfx.args.y, scatterSfx.args.y, "掉落起点为当前放置格子");

  // 推进 900ms 后到账。
  tick(sim, 900);
  assert.deepEqual(ResourceCmd.calls, [{ kind: "starshard", amount: 1 }]);
});

test("Lv9 激光伤害 2000", () => {
  resetSim();
  applyInstantPlant(MagicPowderData, { level: 9 });
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 2000);
});

test("星之碎片对魔法粉没有额外效果", () => {
  resetSim();
  ProjectileCmd.reset();
  MagicPowderData.onStarShards();
  assert.equal(ProjectileCmd.calls.length, 0);
});

test("一次性植物标记与放置规则", () => {
  assert.equal(MagicPowderData.isOneTimePlant, true);
  assert.equal(MagicPowderData.placementRule, "overlayAny");
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   1–8 级激光伤害 1500，9 级提升到 2000；
 *   5 级消耗从 175 降到 150；9 级冷却从 55s 降到 48s。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：damage / cost / cooldown 都是 Model 中的 LevelScaledValue 阈值定义。
 */
test("Lv1–Lv9 伤害、消耗与冷却成长表", () => {
  assert.deepEqual(
    levelValues((level) => MagicPowderData.damage.getValueAt(level)),
    [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 2000],
  );
  assert.deepEqual(
    levelValues((level) => MagicPowderData.cost.getValueAt(level)),
    [175, 175, 175, 175, 150, 150, 150, 150, 150],
  );
  assert.deepEqual(
    levelValues((level) => MagicPowderData.cooldown.getValueAt(level)),
    [55000, 55000, 55000, 55000, 55000, 55000, 55000, 55000, 48000],
  );
});
