import test from "node:test";
import assert from "node:assert/strict";
import {
  EARLY_WATERWAY_SAFE_WAVES,
  getEarlySpawnRows,
  getEarlyWaterwayExceptLine,
  getInitialWaterRows,
} from "../../src/game/utils/helper/StageTerrain.ts";
import stage1 from "../../src/game/stages/chapter1/stage1.ts";
import stage5 from "../../src/game/stages/chapter1/stage5.ts";
import stage7 from "../../src/game/stages/chapter1/stage7.ts";
import stage8 from "../../src/game/stages/chapter1/stage8.ts";
import stage9 from "../../src/game/stages/chapter1/stage9.ts";

/**
 * 描述（关卡地形纯函数 / StageTerrain）：
 *   地形不再是按 stageId 写死的表，而是由各关卡脚本 `LevelScript.terrain` 显式声明，
 *   再由纯函数推导：getInitialWaterRows 取开局水路行；getEarlySpawnRows 取前 3 波
 *   允许刷怪的行；getEarlyWaterwayExceptLine 取其反面作为 wave.exceptLine。
 *
 * 验收路径：
 *   1) 断言各关脚本声明的 terrain（stage5/8 水路行 [2,3]、白名单 [0,1,4,5]；
 *      stage1 白名单 [0,4]；stage7 [0]；stage9 无特殊地形）。
 *   2) 用显式 terrain 配置驱动三个纯函数，断言白名单、补集与越界裁剪。
 *   3) 断言 exceptLine 只在前 3 波生效。
 *
 * 预期结果：
 *   stage5/8 initialWaterRows=[2,3]、earlySpawnRows=[0,1,4,5]；stage1=[0,4]；stage7=[0]；
 *   无 terrain 时允许全部行；exceptLine 前 3 波为允许行补集、第 4 波起为空。
 *
 * 为什么：
 *   generateStageScript 运行时水面格尚未设置（在 onNewWave 之后才由脚本写入），
 *   图鉴页也没有游戏场景，故两者都只依赖脚本声明的纯数据，避开时序陷阱。
 */

test("各关脚本声明的地形数据", () => {
  assert.deepEqual([...(stage5.script.terrain?.initialWaterRows ?? [])], [2, 3]);
  assert.deepEqual([...(stage5.script.terrain?.earlySpawnRows ?? [])], [0, 1, 4, 5]);
  assert.deepEqual([...(stage8.script.terrain?.initialWaterRows ?? [])], [2, 3]);
  assert.deepEqual([...(stage8.script.terrain?.earlySpawnRows ?? [])], [0, 1, 4, 5]);
  assert.deepEqual([...(stage1.script.terrain?.earlySpawnRows ?? [])], [0, 4]);
  assert.deepEqual([...(stage7.script.terrain?.earlySpawnRows ?? [])], [0]);
  assert.equal(stage9.script.terrain?.initialWaterRows, undefined);
  assert.equal(stage9.script.terrain?.earlySpawnRows, undefined);
});

test("纯函数：白名单、补集与越界裁剪", () => {
  const water = { initialWaterRows: [2, 3], earlySpawnRows: [0, 1, 4, 5] };
  assert.deepEqual([...getInitialWaterRows(water)], [2, 3]);
  assert.deepEqual(getEarlySpawnRows(water, 6), [0, 1, 4, 5]);
  // 越界裁剪。
  assert.deepEqual(getEarlySpawnRows(water, 4), [0, 1]);
  // 无 terrain 时允许全部行。
  assert.deepEqual(getEarlySpawnRows(undefined, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual([...getInitialWaterRows(undefined)], []);
});

test("exceptLine 是允许行的补集，且只在前 3 波生效", () => {
  assert.equal(EARLY_WATERWAY_SAFE_WAVES, 3);
  const water = { initialWaterRows: [2, 3], earlySpawnRows: [0, 1, 4, 5] };
  assert.deepEqual(getEarlyWaterwayExceptLine(water, 0, 6), [2, 3]);
  assert.deepEqual(getEarlyWaterwayExceptLine(water, 3, 6), [2, 3]);
  assert.deepEqual(getEarlyWaterwayExceptLine(water, 4, 6), []);
  // stage1 白名单 [0,4] → 排除 [1,2,3]。
  const s1 = { earlySpawnRows: [0, 4] };
  assert.deepEqual(getEarlyWaterwayExceptLine(s1, 1, 5), [1, 2, 3]);
  // 无 terrain 不排除任何行。
  assert.deepEqual(getEarlyWaterwayExceptLine(undefined, 1, 6), []);
});
