import test from "node:test";
import assert from "node:assert/strict";
import {
  EARLY_WATERWAY_SAFE_WAVES,
  getEarlySpawnRows,
  getEarlyWaterwayExceptLine,
  getInitialWaterRows,
} from "../../src/game/utils/helper/StageTerrain.ts";

/**
 * 描述（关卡地形纯函数 / StageTerrain）：
 *   移除 JSON 的 stageScript.waterWays 后，水路行与前 3 波刷怪白名单都由本纯函数按 stageId
 *   静态推导。getInitialWaterRows 是"第 0 波初始化后的真实水面行"的唯一数据源，供
 *   PresetEventManager 设置 GridManager 与图鉴地图预览共用；getEarlySpawnRows 是前 3 波
 *   允许刷怪的行（旧 waterWays 的反面）；getEarlyWaterwayExceptLine 给出对应的排除行。
 *
 * 验收路径：
 *   1) 断言真实水面行：stage 5/8 为 [2,3]，其余为空。
 *   2) 断言前 3 波允许行：ch1(5行)→[0,4]、ch5/ch8(6行)→[0,1,4,5]、ch7(4行)→[0]，
 *      其余关为全部行；并验证越界行被裁剪。
 *   3) 断言 exceptLine = 所有行 - 允许行，且只在前 3 波生效（waveId>3 为空）。
 *
 * 预期结果：
 *   water 行仅 5/8 有；exceptLine 在前 3 波为允许行的补集；第 4 波起为空。
 *
 * 为什么：
 *   generateStageScript 运行时水面格尚未设置（在 onNewWave 之后才由 PresetEventManager
 *   写入），图鉴页也没有游戏场景，故两者必须共用不依赖运行时状态的纯函数，避免时序分叉。
 */

test("真实水面行：仅 stage 5/8 有 row 2、3", () => {
  assert.deepEqual([...getInitialWaterRows(5)], [2, 3]);
  assert.deepEqual([...getInitialWaterRows(8)], [2, 3]);
  for (const id of [1, 2, 3, 4, 6, 7, 9]) {
    assert.deepEqual([...getInitialWaterRows(id)], [], `stage ${id} 不应有水面行`);
  }
});

test("前 3 波允许刷怪行：旧 waterWays 的反面白名单", () => {
  assert.deepEqual(getEarlySpawnRows(1, 5), [0, 4]);
  assert.deepEqual(getEarlySpawnRows(5, 6), [0, 1, 4, 5]);
  assert.deepEqual(getEarlySpawnRows(7, 4), [0]);
  assert.deepEqual(getEarlySpawnRows(8, 6), [0, 1, 4, 5]);
  // 无配置的关卡返回全部行。
  assert.deepEqual(getEarlySpawnRows(2, 6), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(getEarlySpawnRows(3, 4), [0, 1, 2, 3]);
  // 越界裁剪。
  assert.deepEqual(getEarlySpawnRows(5, 4), [0, 1]);
});

test("exceptLine 是允许行的补集，且只在前 3 波生效", () => {
  assert.equal(EARLY_WATERWAY_SAFE_WAVES, 3);
  assert.deepEqual(getEarlyWaterwayExceptLine(5, 0, 6), [2, 3]);
  assert.deepEqual(getEarlyWaterwayExceptLine(5, 3, 6), [2, 3]);
  assert.deepEqual(getEarlyWaterwayExceptLine(5, 4, 6), []);
  assert.deepEqual(getEarlyWaterwayExceptLine(1, 1, 5), [1, 2, 3]);
  assert.deepEqual(getEarlyWaterwayExceptLine(7, 2, 4), [1, 2, 3]);
  assert.deepEqual(getEarlyWaterwayExceptLine(2, 1, 6), []);
});
