import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnMob,
  tick,
  MobCmd,
  ObstacleCmd,
} from "../harness/sim.mjs";
import { CentipedeData } from "../../src/game/presets/monster/centipede/centipede.ts";

/**
 * 描述（Centipede）：
 *   蜈蚣 Boss 入场 250ms 后进入 6s 技能循环，轮流使用：
 *   1) 冲撞：向前 5 格，主路径秒杀半血、上下行 100 伤害；
 *   2) 召唤：随机 3 行各召唤 1 只幼虫（mid=18）；
 *   3) 爆破：随机 2 列各造成 3×3、500 伤害；
 *   血量 80/60/40/20% 时额外释放落石，50% 时闪屏。
 *
 * 验收路径：
 *   1) 推进 250ms 检查入场 hook。
 *   2) 直接调用 castSkill1/2/3，检查 MobCmd 的伤害格与召唤。
 *   3) 设置血量到 79%，调用 checkHealthTriggers，推进 1100ms 检查落石障碍。
 *   4) 设置血量到 49.5%，检查 flashTriggered 与半血 hook。
 *
 * 预期结果：
 *   冲撞 cells 3..8 行 2、伤害 49944994；上下行各 6 格 100；
 *   召唤 3 个 mid=18、col=8；爆破 2 组各 9 格 500；
 *   落石生成 oid=2、hp=300 障碍；49.5% 触发闪屏。
 *
 * 为什么：
 *   castSkill1 的 targetCol=max(2,col-5)，并 DamagePlantsInCells(SECKILL/2)；
 *   castSkill2 选 3 行，SummonSfx 450ms 后 SpawnMinion；
 *   castSkill3 从 [3,4,5] 选 2 列，BlastImpact 对 3×3 造成 500；
 *   rockImpact 创建 MineRockObstacleData(oid=2) hp=300。
 */

test("入场 250ms 触发 spawn hook 并停止移动", () => {
  const sim = resetSim();
  const { entity } = spawnMob(CentipedeData, { col: 8, row: 2 });

  tick(sim, 250);
  assert.equal(entity.viewCalls.includes("spawnHooks"), true);
  assert.equal(entity.moveCalls.includes("stop"), true);
});

test("冲撞对主路径秒杀、上下行 100 伤害", () => {
  resetSim();
  const { model, entity } = spawnMob(CentipedeData, { col: 8, row: 2 });

  model.castSkill1(entity);
  const damages = MobCmd.calls.filter((call) => call.kind === "damageCells");
  assert.equal(damages.length, 3);
  assert.deepEqual(damages[0].cells.map((cell) => cell.col), [3, 4, 5, 6, 7, 8]);
  assert.equal(damages[0].cells.every((cell) => cell.row === 2), true);
  assert.equal(damages[0].damage, 49944994);
  assert.equal(damages[1].damage, 100);
  assert.equal(damages[2].damage, 100);
  assert.deepEqual(damages[1].cells.map((cell) => cell.row), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(damages[2].cells.map((cell) => cell.row), [3, 3, 3, 3, 3, 3]);
  assert.equal(entity.col, 3);
});

test("召唤技能在 3 行各生成 1 只幼虫", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(CentipedeData, { col: 8, row: 2 });

  model.castSkill2(entity);
  tick(sim, 1_150);

  const minions = MobCmd.calls.filter((call) => call.kind === "spawn" && call.mid === 18);
  assert.equal(minions.length, 3);
  assert.equal(minions.every((call) => call.col === 8), true);
  assert.equal(new Set(minions.map((call) => call.row)).size, 3);
  assert.equal(entity.viewCalls.filter((call) => call === "summonEffects").length, 3);
});

test("爆破技能生成 2 组 3×3、500 伤害", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(CentipedeData, { col: 8, row: 2 });

  model.castSkill3(entity);
  tick(sim, 1_000);

  const damages = MobCmd.calls.filter((call) => call.kind === "damageCells");
  assert.equal(damages.length, 2);
  for (const damage of damages) {
    assert.equal(damage.cells.length, 9);
    assert.equal(damage.damage, 500);
    assert.equal([3, 4, 5].includes(damage.cells[4].col), true);
  }
});

test("79% 血量触发落石并生成 300 血障碍", () => {
  const sim = resetSim();
  const { model, entity } = spawnMob(CentipedeData, { col: 8, row: 2 });
  model.health = 15_800;

  model.checkHealthTriggers(entity);
  assert.deepEqual(model.hpTriggers, [0.8]);
  assert.equal(MobCmd.calls.some((call) => call.kind === "announce" && call.skillKey === "mine_rock"), true);

  tick(sim, 1_100);
  assert.equal(ObstacleCmd.calls.length, 1);
  assert.equal(ObstacleCmd.calls[0].oid, 2);
  assert.equal(ObstacleCmd.calls[0].config.hp, 300);
});

test("49.5% 血量触发半血闪屏", () => {
  resetSim();
  const { model, entity } = spawnMob(CentipedeData, { col: 8, row: 2 });
  model.health = 9_900;

  model.checkHealthTriggers(entity);
  assert.equal(model.flashTriggered, true);
  assert.equal(entity.viewCalls.includes("sceneFlash"), true);
  assert.equal(entity.viewCalls.includes("halfHealthHooks"), true);
});

test("消失后重新出现在最后一列并继续循环", () => {
  resetSim();
  const { model, entity } = spawnMob(CentipedeData, { col: 8, row: 2 });

  model.beginDisappear(entity);

  assert.equal(model.isHidden, false);
  assert.equal(entity.col, 8);
  assert.equal(entity.row >= 0 && entity.row <= 4, true);
  assert.equal(entity.viewCalls.includes("arcReposition"), true);
});
