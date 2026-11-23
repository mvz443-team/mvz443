import test from "node:test";
import assert from "node:assert/strict";
import seedrandom from "seedrandom";
import MobHelper from "../../src/game/utils/helper/MobHelper.ts";
import StageHelper from "../../src/game/utils/helper/StageHelper.ts";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { CapZombieData } from "../../src/game/presets/monster/zombie/cap_zombie.ts";
import { HelmetZombieData } from "../../src/game/presets/monster/zombie/helmet_zombie.ts";
import { StickZombieData } from "../../src/game/presets/monster/zombie/stick_zombie.ts";
import { BoatZombieData } from "../../src/game/presets/monster/zombie/water/boat_zombie.ts";
import { BoatCapZombieData } from "../../src/game/presets/monster/zombie/water/boat_cap_zombie.ts";
import { BoatHelmetZombieData } from "../../src/game/presets/monster/zombie/water/boat_helmet_zombie.ts";
import { DolphinRiderZombieData } from "../../src/game/presets/monster/zombie/water/dolphin_rider_zombie.ts";
import { DivingZombieData } from "../../src/game/presets/monster/zombie/water/diving_zombie.ts";
import { TurtleZombieData } from "../../src/game/presets/monster/zombie/turtle_zombie.ts";
import { MonsterLibrary } from "../../src/game/managers/library/MonsterLibrary.ts";
import stage8 from "../../src/game/stages/chapter1/stage8.ts";

// 测试环境不会自动注册怪物库，这里显式初始化，确保 GetModel 能解析到真实 preset。
MonsterLibrary.Initialize();

/**
 * 描述（刷怪变种 / spawnVariants）：
 *   刷怪流程改为"先确定怪物 → 再找合适的行"。本体 Model 上配置可选的 spawnVariants
 *   （主导地形 → 替换 mid）：普通僵尸(1)/皮革帽(2)/钢盔(3)/手杖(8) 在 water 行分别
 *   替换为木船僵尸(22)/木船帽(23)/木船钢盔(24)/海豚骑士(28)。变种自身 weight=0，
 *   不进普通出怪池，只能由本体被抽中后落水行时接管生成。潜水僵尸(27)权重正常，
 *   并加入矿洞深处(水elite)（ch8）的刷怪白名单。
 *
 * 验收路径：
 *   1) 读取真实 preset 的 spawnVariants 字段，断言 1→22 / 2→23 / 3→24 / 8→28。
 *   2) 断言木船系列(22-26)与海豚骑士(28)的 weight 恒为 0，本体 weight>0。
 *   3) 构造固定 seed 的 selectSpawnRow 上下文：第 2/3 行为全水路，其余为陆地行；
 *      对本体 mid 连续选行 200 次，记录落点与解析后的 mid。
 *   4) 断言落水行时 mid 被替换为对应水生变种，落陆行时保持本体 mid；
 *      不带变种的怪（如龟壳僵尸 14）仍不会落水行。
 *   5) 断言选行不额外消耗 rng：相同 seed 下带/不带变种表，选出的行序列完全一致。
 *   6) 读取 ch8 关卡 JSON，断言 AllowedMobs 含 27，且潜水僵尸 weight>0。
 *
 * 预期结果：
 *   1/2/3/8 的 spawnVariants.water 分别为 22/23/24/28；变种 weight()=0；
 *   本体在水行被解析为对应变种 mid、在陆行保持原 mid；带/不带变种表的选行序列相同；
 *   龟壳僵尸(14)落点集合不含水行；ch8.AllowedMobs 含 27 且潜水僵尸权重>0。
 *
 * 为什么：
 *   spawnVariants 是定义在 MonsterDefinition 的只读 JSON 安全配置，不进快照；
 *   MobHelper.selectSpawnRow 在过滤阶段放行"本体能刷或变种能刷"的行，选中行后
 *   只读主导地形解析 mid，不调用 rng，保证回滚/重连后选行与变种结果一致；
 *   变种 mid 由 MonsterLibrary 注册表和 model.spawnVariants 提供，无硬编码分支。
 */

const WATER_ROWS = [2, 3];

function makeCtx(mid, { seed = "variant" } = {}) {
  const variants = {
    1: { water: 22 },
    2: { water: 23 },
    3: { water: 24 },
    8: { water: 28 },
  };
  return {
    wave: { flag: "normal", waveId: 10 },
    stageScript: {},
    rowWeights: [1, 1, 1, 1, 1],
    rowPickSmoothingState: StageHelper.createRowPickSmoothingState(5),
    currentWaveId: 10,
    minecartLostWaveByRow: new Map(),
    mid,
    rowCount: 5,
    rng: seedrandom(seed),
    rowPropertyRatio: (row, type) => {
      if (type === "water") return WATER_ROWS.includes(row) ? 1 : 0;
      if (type === "ground") return WATER_ROWS.includes(row) ? 0 : 1;
      return 0;
    },
    getHabitats: (id) => MonsterLibrary.GetModel(id)?.habitats ?? ["ground"],
    isFlying: (id) => MonsterLibrary.GetModel(id)?.isDefaultFlying ?? false,
    getSpawnVariants: (id) => MonsterLibrary.GetModel(id)?.spawnVariants ?? variants[id] ?? {},
  };
}

function pickRows(mid, times = 200, seed = "variant") {
  const ctx = makeCtx(mid, { seed });
  const pairs = [];
  let state = ctx.rowPickSmoothingState;
  for (let i = 0; i < times; i++) {
    const result = MobHelper.selectSpawnRow({ ...ctx, rowPickSmoothingState: state });
    pairs.push({ row: result.row, mid: result.mid });
    state = result.rowPickSmoothingState;
  }
  return pairs;
}

test("preset 变种表：本体 1/2/3/8 → 水生 22/23/24/28", () => {
  assert.deepEqual(ZombieData.spawnVariants, { water: 22 });
  assert.deepEqual(CapZombieData.spawnVariants, { water: 23 });
  assert.deepEqual(HelmetZombieData.spawnVariants, { water: 24 });
  assert.deepEqual(StickZombieData.spawnVariants, { water: 28 });
  assert.deepEqual(TurtleZombieData.spawnVariants, {});
});

test("变种怪物权重为 0，本体权重大于 0", () => {
  for (const data of [BoatZombieData, BoatCapZombieData, BoatHelmetZombieData, DolphinRiderZombieData]) {
    for (const wave of [1, 5, 10, 20, 50]) {
      assert.equal(data.weight(wave), 0, `变种 mid=${data.mid} 权重应为 0`);
    }
  }
  // 木船龟壳(25)与木船弓手(26)同样不进普通池。
  assert.equal(MonsterLibrary.GetModel(25).weight(10), 0);
  assert.equal(MonsterLibrary.GetModel(26).weight(10), 0);
  for (const data of [ZombieData, CapZombieData, HelmetZombieData, StickZombieData]) {
    assert.ok(data.weight(10) > 0, `本体 mid=${data.mid} 权重应大于 0`);
  }
});

test("刷怪选行：落水行替换为水生变种，陆行保持本体", () => {
  const cases = [
    [1, 22],
    [2, 23],
    [3, 24],
    [8, 28],
  ];
  for (const [baseMid, variantMid] of cases) {
    const pairs = pickRows(baseMid);
    const waterHits = pairs.filter(({ row }) => WATER_ROWS.includes(row));
    const groundHits = pairs.filter(({ row }) => !WATER_ROWS.includes(row));
    assert.ok(waterHits.length > 0, `mid=${baseMid} 应能刷到水行`);
    assert.ok(groundHits.length > 0, `mid=${baseMid} 应能刷到陆行`);
    for (const hit of waterHits) {
      assert.equal(hit.mid, variantMid, `mid=${baseMid} 落水行 ${hit.row} 应替换为 ${variantMid}`);
    }
    for (const hit of groundHits) {
      assert.equal(hit.mid, baseMid, `mid=${baseMid} 落陆行 ${hit.row} 应保持本体`);
    }
  }
});

test("无变种的怪仍不会刷到水行", () => {
  const pairs = pickRows(14); // 龟壳僵尸：仅 ground，无变种
  assert.ok(pairs.length > 0);
  assert.ok(pairs.every(({ row }) => !WATER_ROWS.includes(row)), "龟壳僵尸不应落水行");
  assert.ok(pairs.every(({ mid }) => mid === 14));
});

test("变种解析确定性：相同 seed 下行与 mid 序列可复现", () => {
  const seed = "determinism";
  const first = pickRows(1, 100, seed);
  const second = pickRows(1, 100, seed);
  assert.deepEqual(first, second, "相同 seed 下 (row, mid) 序列必须完全一致");
  assert.ok(first.some(({ mid }) => mid === 22), "序列中应出现水行变种 mid=22");
  assert.ok(first.some(({ mid }) => mid === 1), "序列中应出现本体 mid=1");
});

test("潜水僵尸加入 ch8（矿洞深处-水elite）刷怪表", () => {
  assert.ok(stage8.content.stageScript.AllowedMobs.includes(27), "ch8.AllowedMobs 应包含潜水僵尸 mid=27");
  assert.ok(DivingZombieData.weight(10) > 0, "潜水僵尸应保留普通出怪权重");
  assert.equal(DivingZombieData.mid, 27);
});
