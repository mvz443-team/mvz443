import test from "node:test";
import assert from "node:assert/strict";
import { resetSim, spawnMob, tick, MobCmd } from "../harness/sim.mjs";
import { EvokerData } from "../../src/game/presets/monster/zombie/evoker.ts";

/**
 * 描述（Evoker）：
 *   唤魔者在战斗中周期召唤 4 名卫道士，分布在自身前后左右 4 格；
 *   召唤后停止攻击/移动 3000ms，再恢复移动。
 *
 * 验收路径：
 *   1) 推进到首次召唤时刻，统计 MobCmd.Spawn 的 mid/col/row。
 *   2) 再推进 3000ms，检查恢复移动。
 *   3) 冻结时不应召唤。
 *
 * 预期结果：
 *   首次召唤在 4000ms（schedule delay=28000、startAt=24000 的
 *   firstInterval=delay-startAt），生成 4 个 mid=10：
 *   (9,2)、(7,2)、(8,1)、(8,3)，waveID=-10；7000ms 恢复移动。
 *
 * 为什么：
 *   EvokerModel.onCreate 用 schedule(Summon,28000,{startAt:24000,repeat:3})；
 *   summonVindicator 遍历 4 个相邻格调用 MobCmd.Spawn(VindicatorData.mid,...,-10)，
 *   并 schedule(Resume,3000)。
 */

test("首次召唤 4 名卫道士并覆盖前后左右", () => {
  const sim = resetSim();
  const { entity } = spawnMob(EvokerData, { col: 8, row: 2 });

  tick(sim, 4_000);
  const spawns = MobCmd.calls.filter((call) => call.kind === "spawn");
  assert.equal(spawns.length, 4);
  assert.deepEqual(
    spawns.map((call) => [call.mid, call.col, call.row, call.waveID]),
    [
      [10, 9, 2, -10],
      [10, 7, 2, -10],
      [10, 8, 1, -10],
      [10, 8, 3, -10],
    ],
  );
  assert.equal(entity.viewCalls.includes("start"), false);
});

test("召唤后 3000ms 恢复移动", () => {
  const sim = resetSim();
  const { entity } = spawnMob(EvokerData, { col: 8, row: 2 });

  tick(sim, 4_000);
  const startsAfterSummon = entity.moveCalls.filter((call) => call === "start").length;
  tick(sim, 3_000);
  assert.equal(
    entity.moveCalls.filter((call) => call === "start").length,
    startsAfterSummon + 1,
  );
});

test("冻结时不召唤", () => {
  const sim = resetSim();
  const { model } = spawnMob(EvokerData, { col: 8, row: 2 });
  model.isFrozen = true;

  tick(sim, 4_000);
  assert.equal(MobCmd.calls.filter((call) => call.kind === "spawn").length, 0);
});
