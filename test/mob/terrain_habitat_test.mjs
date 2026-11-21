import test from "node:test";
import assert from "node:assert/strict";
import seedrandom from "seedrandom";
import {
  canSpawnMonsterInRow,
  canSurviveOn,
  dominantHabitat,
  normalizeHabitats,
} from "../../src/game/core/logic/TerrainHabitat.ts";
import MobHelper from "../../src/game/utils/helper/MobHelper.ts";
import StageHelper from "../../src/game/utils/helper/StageHelper.ts";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { ObsidianGolemData } from "../../src/game/presets/monster/golem/golem_obsidian.ts";
import { WardenData } from "../../src/game/presets/monster/golem/warden.ts";
import { CentipedeData } from "../../src/game/presets/monster/centipede/centipede.ts";
import { CentipedeMinionData } from "../../src/game/presets/monster/centipede/centipede_minion.ts";
import { BalloonZombieData } from "../../src/game/presets/monster/zombie/chapter2/balloon_zombie.ts";

/**
 * 描述（地形通行域 / 刷怪行过滤）：
 *   怪物的"能刷在哪、能活在哪"（TerrainHabitat）与"谁能打中谁"（BodyTraits 的
 *   tiny/flying/inVoid）是两套正交规则。关卡每行的 ground/water/sky 占比决定主导地形：
 *   水面或空域占比 > 50% 时该行只刷对应通行域的怪，普通地面行只刷地面怪；
 *   飞行怪无视地形，可刷任意行。golem 与 centipede 系可水陆两栖，其余怪缺省仅地面。
 *
 * 验收路径：
 *   1) 直接调用 TerrainHabitat 纯函数，覆盖阈值 50% 边界、缺省回落、飞行豁免。
 *   2) 构造固定 seed 的 selectSpawnRow 上下文：5 行中第 2/3 行整行水面，
 *      分别让"仅地面怪""仅水怪""飞行怪"连续选行 200 次，观察落点行集合。
 *   3) 全水路极端场景验证不会回落到"最后一行"造成陆地怪刷进水里。
 *   4) 读取真实 preset 的 habitats 字段，确认 golem/centipede 可水、普通僵尸仅地面。
 *
 * 预期结果：
 *   water=0.6 → 主导 water；sky=0.6 → 主导 air；恰好 0.5 → 无主导（按地面行）；
 *   仅地面怪永远不落在第 2/3 行；仅水怪只落在第 2/3 行；飞行怪五行都可达；
 *   全水路下仅地面怪仍能选出 0..4 的合法行（回退基础权重，不刷进"最后一行"特例）；
 *   golem/centipede 的 habitats 含 "water"，普通僵尸为 ["ground"]。
 *
 * 为什么：
 *   TerrainHabitat.canSpawnMonsterInRow 用显式的 dominantHabitat + includes 判断，
 *   不依赖 Set/Map 遍历顺序，保证回滚/重连后选行一致；
 *   MobHelper.selectSpawnRow 在过滤后候选为空时回退到基础权重而不是让
 *   StageHelper.weightedRandomRow 的默认分支返回最后一行，避免"陆地怪落水"穿帮。
 */

function makeCtx({ waterRows = [], skyRows = [], habitats, isFlying = false, seed = "habitat" }) {
  return {
    wave: { flag: "normal", waveId: 4 },
    stageScript: { waterWays: waterRows },
    rowWeights: [1, 1, 1, 1, 1],
    rowPickSmoothingState: StageHelper.createRowPickSmoothingState(5),
    currentWaveId: 4,
    minecartLostWaveByRow: new Map(),
    mid: 1,
    rowCount: 5,
    rng: seedrandom(seed),
    rowPropertyRatio: (row, type) => {
      if (type === "water") return waterRows.includes(row) ? 1 : 0;
      if (type === "sky") return skyRows.includes(row) ? 1 : 0;
      if (type === "ground") return waterRows.includes(row) || skyRows.includes(row) ? 0 : 1;
      return 0;
    },
    getHabitats: () => habitats,
    isFlying: () => isFlying,
  };
}

function pickRows(ctx, times = 200) {
  const rows = new Set();
  let state = ctx.rowPickSmoothingState;
  for (let i = 0; i < times; i++) {
    const result = MobHelper.selectSpawnRow(ctx);
    rows.add(result.row);
    state = result.rowPickSmoothingState;
  }
  return { rows, state };
}

test("通行域纯函数：阈值、缺省与飞行豁免", () => {
  assert.deepEqual(normalizeHabitats(undefined), ["ground"]);
  assert.deepEqual(normalizeHabitats([]), ["ground"]);
  assert.deepEqual(normalizeHabitats(["water"]), ["water"]);

  assert.equal(dominantHabitat({ ground: 0.4, water: 0.6, void: 0, sky: 0 }), "water");
  assert.equal(dominantHabitat({ ground: 0, water: 0.4, void: 0, sky: 0.6 }), "air");
  assert.equal(dominantHabitat({ ground: 0.5, water: 0.5, void: 0, sky: 0 }), null);

  assert.equal(canSurviveOn(["water"], "water"), true);
  assert.equal(canSurviveOn(["ground"], "water"), false);
  assert.equal(canSurviveOn(["air"], "sky"), true);
  assert.equal(canSurviveOn(["air"], "void"), true);

  const waterRow = { ground: 0, water: 1, void: 0, sky: 0 };
  assert.equal(canSpawnMonsterInRow({ habitats: ["ground"], isFlying: false, ratios: waterRow }), false);
  assert.equal(canSpawnMonsterInRow({ habitats: ["water"], isFlying: false, ratios: waterRow }), true);
  assert.equal(canSpawnMonsterInRow({ habitats: ["ground"], isFlying: true, ratios: waterRow }), true);
});

test("刷怪选行：水路行不会刷陆地怪", () => {
  const ctx = makeCtx({ waterRows: [2, 3], habitats: ["ground"] });
  const { rows } = pickRows(ctx);
  assert.ok(rows.size >= 2, "应覆盖多个陆地行");
  for (const row of rows) {
    assert.ok(row !== 2 && row !== 3, `陆地怪不应落在水路行 ${row}`);
  }
});

test("刷怪选行：水生怪只落水路行", () => {
  const ctx = makeCtx({ waterRows: [2, 3], habitats: ["water"] });
  const { rows } = pickRows(ctx);
  assert.ok(rows.size > 0);
  for (const row of rows) {
    assert.ok(row === 2 || row === 3, `水怪不应落在陆地行 ${row}`);
  }
});

test("刷怪选行：飞行怪无视地形", () => {
  const ctx = makeCtx({ waterRows: [2, 3], habitats: ["ground"], isFlying: true });
  const { rows } = pickRows(ctx);
  assert.deepEqual([...rows].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

test("刷怪选行：空域行只刷空域通行域怪", () => {
  const ctx = makeCtx({ skyRows: [1], habitats: ["air"] });
  const { rows } = pickRows(ctx);
  assert.deepEqual([...rows], [1]);
});

test("刷怪选行：全水路极端场景回退基础权重", () => {
  const ctx = makeCtx({ waterRows: [0, 1, 2, 3, 4], habitats: ["ground"] });
  const { rows } = pickRows(ctx);
  assert.ok([...rows].every(row => row >= 0 && row <= 4));
  assert.ok(rows.size > 0);
});

test("真实 preset 的通行域字段", () => {
  assert.deepEqual(ZombieData.habitats, ["ground"]);
  assert.deepEqual(BalloonZombieData.habitats, ["ground"]);
  for (const data of [ObsidianGolemData, WardenData, CentipedeData, CentipedeMinionData]) {
    assert.deepEqual(data.habitats, ["ground", "water"], `mid=${data.mid} 应可水陆两栖`);
  }
});
