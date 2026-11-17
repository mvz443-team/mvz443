import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  spawnMob,
  makePlantTarget,
  tick,
  ProjectileCmd,
  SfxCmd,
  getObstaclesMap,
  levelValues,
} from "../harness/sim.mjs";
import { TntMinesData } from "../../src/game/presets/plant/chapter1/tnt_mines.ts";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { GetDecValue } from "../../src/utils/numbervalue.ts";

/**
 * 描述（tnt_mines_description）：
 *   地雷初始埋在地下，约 15s 后出土；出土前被踩不会爆炸，出土后接触敌人立即爆炸；
 *   飞行单位经过时等待其落地；星之碎片立即出土并在场上再布置 2 颗地雷。
 *
 * 验收路径：
 *   1) 用 tick 推进 15s，检查 isBuried 的翻转时刻。
 *   2) 直接调用真实 handleContact / explode，覆盖埋藏、同阵营、飞行、普通敌人。
 *   3) 检查 explode 的 hasExploded 防重复。
 *   4) 星碎后从 tickmanager.capture() 读取 2 个 TntMinesSpawnMine 定时器。
 *
 * 预期结果：
 *   Lv1 15000ms 出土；爆炸伤害 1500、rightGrid 1（9 级 1.5）、leftGrid 0.5；
 *   埋藏/同阵营返回 ignore，飞行返回 pending，普通敌人返回 explode；
 *   星碎后 2 个生成地雷事件，每个延迟 1000ms。
 *
 * 为什么：
 *   onCreate 用 GetDecValue(15000, 0.8, level) 排 Wakeup；
 *   explode 先检查 hasExploded 再创建爆炸并 destroySelf；
 *   handleContact 按 isBuried / faction / isFlying 分支；
 *   onStarShards 对 2 个目标位置各 schedule 一次 SpawnMine。
 */

test("Lv1 地雷 15000ms 后出土", () => {
  const sim = resetSim();
  const { model } = spawnPlant(TntMinesData, { level: 1, row: 2 });
  assert.equal(model.isBuried, true);

  tick(sim, 14_950);
  assert.equal(model.isBuried, true);
  tick(sim, 50);
  assert.equal(model.isBuried, false);
});

test("出土后接触普通敌人立即爆炸，且只爆炸一次", () => {
  resetSim();
  const { model, entity } = spawnPlant(TntMinesData, { level: 1, row: 2 });
  model.isBuried = false;
  const zombie = spawnMob(ZombieData, { col: 2, row: 2 });

  assert.equal(model.handleContact(entity, zombie.entity), "explode");
  model.explode(entity, 1);
  assert.equal(ProjectileCmd.calls.length, 1);
  const explosion = ProjectileCmd.calls[0];
  assert.equal(explosion.cfg.damage, 1500);
  assert.equal(explosion.cfg.rightGrid, 1);
  assert.equal(explosion.cfg.leftGrid, 0.5);
  assert.equal(explosion.cfg.upGrid, 0);
  assert.equal(entity.destroyed, true);

  model.explode(entity, 1);
  assert.equal(ProjectileCmd.calls.length, 1);
});

test("埋藏、同阵营、飞行单位分别返回 ignore/pending", () => {
  resetSim();
  const { model, entity } = spawnPlant(TntMinesData, { level: 1, row: 2 });
  const ally = makePlantTarget({ col: 1, row: 2, pid: 1 });
  const zombie = spawnMob(ZombieData, { col: 2, row: 2 });

  assert.equal(model.handleContact(entity, zombie.entity), "ignore");

  model.isBuried = false;
  assert.equal(model.handleContact(entity, ally), "ignore");

  zombie.model.isFlying = true;
  assert.equal(model.handleContact(entity, zombie.entity), "pending");

  zombie.model.isFlying = false;
  assert.equal(model.handleContact(entity, zombie.entity), "explode");
});

test("Lv9 爆炸右范围扩大到 1.5 格", () => {
  resetSim();
  const { model, entity } = spawnPlant(TntMinesData, { level: 9, row: 2 });
  model.isBuried = false;
  model.explode(entity, 9);

  assert.equal(ProjectileCmd.calls[0].cfg.rightGrid, 1.5);
});

test("星之碎片立即出土，并安排 2 颗新地雷", () => {
  resetSim();
  const { model, entity } = spawnPlant(TntMinesData, { level: 1, row: 2 });
  SfxCmd.reset();

  model.onStarShards(entity);

  assert.equal(model.isBuried, false);
  assert.equal(SfxCmd.calls.length, 2);
  const spawnTimers = model.tickmanager
    .capture()
    .filter((timer) => timer.kind === "TntMinesSpawnMine");
  assert.equal(spawnTimers.length, 2);
  for (const timer of spawnTimers) {
    assert.equal(timer.args.level, 1);
    assert.equal(typeof timer.args.col, "number");
    assert.equal(typeof timer.args.row, "number");
  }
  assert.equal(getObstaclesMap().size, 0);
});

/**
 * 逐级验收（Lv1–Lv9）：
 *   出土时间按 0.8 的对数曲线从 15000ms 缩短到 12000ms；
 *   5 级冷却从 30s 降到 25s；爆炸伤害固定 1500。
 * 预期结果：下表每一级都必须精确匹配。
 * 为什么：onCreate 用 GetDecValue(15000, 0.8, level) 排 Wakeup，
 *   cooldown / damage 由 LevelScaledValue 定义。
 */
test("Lv1–Lv9 出土时间、冷却与伤害成长表", () => {
  assert.deepEqual(
    levelValues((level) => GetDecValue(15000, 0.8, level)),
    [15000, 14053.605, 13500, 13107.211, 12802.54, 12553.605, 12343.134, 12160.816, 12000],
  );
  assert.deepEqual(
    levelValues((level) => TntMinesData.cooldown.getValueAt(level)),
    [30000, 30000, 30000, 30000, 25000, 25000, 25000, 25000, 25000],
  );
  assert.deepEqual(
    levelValues((level) => TntMinesData.damage.getValueAt(level)),
    [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500],
  );
});
