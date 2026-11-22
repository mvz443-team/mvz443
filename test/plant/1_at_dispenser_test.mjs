import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  spawnPlantWithBaseRule,
  tick,
  setSightTarget,
  flushDeferred,
  getPlantsMap,
  ProjectileCmd,
  PositionManager,
  levelValues,
} from "../harness/sim.mjs";
import { ATDispenserData, ATAirHFireWorkModel } from "../../src/game/presets/plant/chapter1/at_dispenser.ts";
import { DispenserData } from "../../src/game/presets/plant/chapter1/dispenser.ts";
import PlantHelper from "../../src/game/utils/helper/PlantHelper.ts";

/**
 * 描述（at_dispenser_description）：
 *   高伤害烟花发射器，必须种在发射器上；普通攻击向前发射烟花火箭并造成溅射；
 *   星之碎片发射短引信高射火箭，销毁时释放十字集束爆炸。
 *
 * 验收路径：
 *   1) 用 SightLine 替身让目标存在，驱动真实 ATDispenserModel.onCreate。
 *   2) 读取 ProjectileCmd 记录的 HFireWorkModel 配置。
 *   3) 直接实例化 ATAirHFireWorkModel 并调用 onModelDestroy，统计十字爆炸。
 *   4) 在 PlantsMap 放入普通发射器，调用真实 createEntity 验证基座替换。
 *
 * 预期结果：
 *   Lv1 普通火箭 1050ms 触发、1250ms 实际发射，之后每 3550ms 一发，
 *   伤害 300、溅射 100；
 *   Lv9 伤害 420；星碎火箭本体 50、爆炸 300、射程 4 格；
 *   销毁时产生 5 个伤害 300 的爆炸；同格普通发射器被销毁。
 *
 * 为什么：
 *   onCreate 的 addEvent(startAt=2500, delay=3550) 首帧为 delay-startAt=1050ms，
 *   触发后再经过 200ms 动画 delayedCall 才真正发射；
 *   damage = firework(300).setIncRatio(1.4)，9 级取 420；
 *   ATAirHFireWorkModel.onModelDestroy 固定遍历 5 个偏移点。
 */

test("Lv1 普通火箭 1050ms 触发、1250ms 发射，伤害 300 溅射 100", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(ATDispenserData, { level: 1, row: 2 });

  tick(sim, 1_200);
  assert.equal(ProjectileCmd.calls.length, 0);
  tick(sim, 50);
  assert.equal(ProjectileCmd.calls.length, 1);

  const first = ProjectileCmd.calls[0];
  assert.equal(first.model, "HFireWorkModel");
  assert.equal(first.cfg.damage, 300);
  assert.equal(first.cfg.explodeDamage, 100);
  assert.equal(first.cfg.maxDistance, PositionManager.Instance.GRID_SIZEX * 32);

  tick(sim, 3_550);
  assert.equal(ProjectileCmd.calls.length, 2);
});

test("Lv9 普通火箭伤害 420", () => {
  const sim = resetSim();
  setSightTarget(true);
  spawnPlant(ATDispenserData, { level: 9, row: 2 });

  tick(sim, 1_250);
  assert.equal(ProjectileCmd.calls.length, 1);
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 420);
});

test("星之碎片火箭本体 50、爆炸 300，销毁时产生 5 个十字爆炸", () => {
  resetSim();
  const { model, entity } = spawnPlant(ATDispenserData, { level: 1, row: 2 });
  ProjectileCmd.reset();

  model.onStarShards(entity);

  assert.equal(ProjectileCmd.calls.length, 1);
  assert.equal(ProjectileCmd.calls[0].model, "ATAirHFireWorkModel");
  assert.equal(ProjectileCmd.calls[0].cfg.damage, 50);
  assert.equal(ProjectileCmd.calls[0].cfg.explodeDamage, 300);
  assert.equal(ProjectileCmd.calls[0].cfg.maxDistance, PositionManager.Instance.GRID_SIZEX * 4);

  const rocket = new ATAirHFireWorkModel();
  rocket.customExplodeDamage = 300;
  const explosions = [];
  rocket.onModelDestroy({
    gridSizeX: PositionManager.Instance.GRID_SIZEX,
    x: 500,
    y: 300,
    row: 2,
    faction: 1,
    dealer: null,
    createExplosion: (cfg, x, _y, row) => explosions.push({ cfg, x, row }),
  });

  assert.equal(explosions.length, 5);
  for (const explosion of explosions) {
    assert.equal(explosion.cfg.damage, 300);
    assert.equal(explosion.cfg.rightGrid, 1.5);
    assert.equal(explosion.cfg.leftGrid, 1.5);
    assert.equal(explosion.cfg.upGrid, 1);
  }
  assert.deepEqual(explosions.map((item) => item.row), [2, 4, 4, 0, 0]);
});

test("种在普通发射器上会替换并销毁基座", () => {
  resetSim();
  const base = spawnPlant(DispenserData, { level: 1, col: 4, row: 2 });
  getPlantsMap().set("4-2", [base.entity]);

  const { model } = spawnPlantWithBaseRule(ATDispenserData, { level: 1, col: 4, row: 2 });
  flushDeferred();

  assert.equal(model.pid, 14);
  assert.equal(base.entity.destroyed, true);
});

test("替换基座后无论睡醒都继承睡眠状态", () => {
  resetSim();
  const sleepingBase = spawnPlant(DispenserData, { level: 1, col: 4, row: 2 });
  sleepingBase.model.isSleeping = true;
  getPlantsMap().set("4-2", [sleepingBase.entity]);

  const sleepingResult = spawnPlantWithBaseRule(ATDispenserData, { level: 1, col: 4, row: 2 });
  assert.equal(sleepingResult.model.isSleeping, true, "基座睡眠时继承睡眠");
  flushDeferred();

  resetSim();
  const awakeBase = spawnPlant(DispenserData, { level: 1, col: 4, row: 2 });
  awakeBase.model.isSleeping = false;
  getPlantsMap().set("4-2", [awakeBase.entity]);

  const awakeResult = spawnPlantWithBaseRule(ATDispenserData, { level: 1, col: 4, row: 2 });
  assert.equal(awakeResult.model.isSleeping, false, "基座清醒时继承清醒");
  flushDeferred();
});

test("必须种在普通发射器基座上", () => {
  resetSim();
  assert.equal(ATDispenserData.requiredBasePid, DispenserData.pid);

  assert.equal(
    PlantHelper.CanPlantInGrid([], ATDispenserData.pid, { type: "ground" }, ATDispenserData),
    false,
    "空格子不能种反坦克分发器",
  );

  const base = spawnPlant(DispenserData, { level: 1, col: 4, row: 2 });
  assert.equal(
    PlantHelper.CanPlantInGrid([base.entity], ATDispenserData.pid, { type: "ground" }, ATDispenserData),
    true,
    "有发射器基座时可以种",
  );
});

test("睡眠时不发射普通火箭", () => {
  const sim = resetSim();
  setSightTarget(true);
  const { model } = spawnPlant(ATDispenserData, { level: 1, row: 2 });
  model.isSleeping = true;

  tick(sim, 6_000);
  assert.equal(ProjectileCmd.calls.length, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   基础血量按 2 的对数曲线成长；5 级消耗从 450 降到 425；
 *   9 级冷却从 50s 降到 44s；火箭伤害按 1.4 成长到 420。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：maxHealth / cost / cooldown / damage 都是 ATDispenserData 的 Model 数值。
 */
test("Lv1–Lv9 血量、消耗、冷却与伤害成长表", () => {
  assert.deepEqual(
    levelValues((level) => ATDispenserData.maxHealth.getValueAt(level)),
    [450, 591.959, 675, 733.918, 779.619, 816.959, 848.53, 875.878, 900],
  );
  assert.deepEqual(
    levelValues((level) => ATDispenserData.cost.getValueAt(level)),
    [450, 450, 450, 450, 425, 425, 425, 425, 425],
  );
  assert.deepEqual(
    levelValues((level) => ATDispenserData.cooldown.getValueAt(level)),
    [50000, 50000, 50000, 50000, 50000, 50000, 50000, 50000, 44000],
  );
  assert.deepEqual(
    levelValues((level) => ATDispenserData.damage.getValueAt(level)),
    [300, 337.856, 360, 375.712, 387.898, 397.856, 406.275, 413.567, 420],
  );
});
