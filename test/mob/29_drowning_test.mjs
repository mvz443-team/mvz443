import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim, spawnMob, makePlantTarget, setGridType, getPlantsMap,
} from "../harness/sim.mjs";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { DivingZombieData } from "../../src/game/presets/monster/zombie/water/diving_zombie.ts";
import { BoatZombieData } from "../../src/game/presets/monster/zombie/water/boat_zombie.ts";
import {
  applyMonsterDrowning,
  applyPlantDrowning,
  DROWN_RATIO_PER_FRAME,
} from "../../src/game/core/logic/Drowning.ts";

/**
 * 描述（环境溺亡）：
 *   植物/僵尸处于不合适的地形时，每个固定逻辑帧扣最大生命值的 5%。
 *   普通僵尸在水行会溺亡；潜水僵尸与 golem/centipede 免疫；
 *   木船坐骑在架时保护骑手，坐骑被爆炸打碎后骑手开始溺亡；
 *   水格里的植物若同格没有睡莲/船（承载物）也会溺亡。
 *
 * 验收路径：
 *   1) 直接驱动 applyMonsterDrowning / applyPlantDrowning（等价于 stepUpdate 的钩子）。
 *   2) 检查每帧扣血量、20 帧归零、免疫 preset 不掉血、坐骑保护前后差异。
 *   3) 检查水格有/无承载物时植物的扣血差异。
 *
 * 预期结果：
 *   DROWN_RATIO_PER_FRAME = 0.05；普通僵尸 300 血每帧扣 15；
 *   潜水僵尸与 canDrown=false 的 preset 不掉血；
 *   木船坐骑在架不掉血、breakMount 后每帧扣 15；
 *   水格无睡莲植物每帧扣 15，有睡莲（pid 6 carrier）不掉血。
 *
 * 为什么：
 *   溺亡是 Model 侧的确定性每帧状态变化，全部字段进快照；
 *   判定复用 TerrainHabitat / PlantTargeting 的显式规则，不依赖容器遍历顺序。
 */

test("普通僵尸在水行每帧扣 5% 最大血量，20 帧归零", () => {
  resetSim();
  setGridType(8, 2, "water");
  const { model, entity } = spawnMob(ZombieData, { col: 8, row: 2 });
  assert.equal(DROWN_RATIO_PER_FRAME, 0.05);

  applyMonsterDrowning(entity, model);
  assert.equal(model.health, 285);
  for (let i = 0; i < 19; i++) applyMonsterDrowning(entity, model);
  assert.equal(model.health, 0);
  assert.equal(model.isDying, true);
});

test("潜水僵尸对水免疫", () => {
  resetSim();
  setGridType(8, 2, "water");
  const { model, entity } = spawnMob(DivingZombieData, { col: 8, row: 2 });
  for (let i = 0; i < 5; i++) applyMonsterDrowning(entity, model);
  assert.equal(model.health, 300);
});

test("木船坐骑保护骑手，坐骑破碎后开始溺亡", () => {
  resetSim();
  setGridType(8, 2, "water");
  const { model, entity } = spawnMob(BoatZombieData, { col: 8, row: 2 });

  applyMonsterDrowning(entity, model);
  assert.equal(model.health, 300, "坐骑在架时不溺亡");

  model.breakMount(entity);
  applyMonsterDrowning(entity, model);
  assert.equal(model.health, 285, "坐骑被打碎后骑手暴露在水里");
});

test("植物在水格无承载物时溺亡，有睡莲时免疫", () => {
  resetSim();
  setGridType(8, 2, "water");
  const bare = makePlantTarget({ col: 8, row: 2, pid: 1 });
  applyPlantDrowning(bare, bare.model);
  assert.equal(bare.model.health, 285);

  resetSim();
  setGridType(8, 2, "water");
  const lily = makePlantTarget({ col: 8, row: 2, pid: 6 });
  getPlantsMap().set("8-2", [lily]);
  const plant = makePlantTarget({ col: 8, row: 2, pid: 1 });
  getPlantsMap().get("8-2").push(plant);
  applyPlantDrowning(plant, plant.model);
  assert.equal(plant.model.health, 300, "同格有睡莲时不溺亡");
});
