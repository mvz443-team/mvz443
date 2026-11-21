import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnMob,
  setGridType,
} from "../harness/sim.mjs";
import { BoatZombieData } from "../../src/game/presets/monster/zombie/water/boat_zombie.ts";
import { BoatCapZombieData } from "../../src/game/presets/monster/zombie/water/boat_cap_zombie.ts";
import { BoatHelmetZombieData } from "../../src/game/presets/monster/zombie/water/boat_helmet_zombie.ts";
import { BoatTurtleZombieData } from "../../src/game/presets/monster/zombie/water/boat_turtle_zombie.ts";
import { BoatSkeletonBowZombieData } from "../../src/game/presets/monster/zombie/water/boat_skeleton_bow_zombie.ts";
import { ZombieData } from "../../src/game/presets/monster/zombie/zombie.ts";
import { MonsterEntity } from "../../src/game/models/entities/MonsterEntity.ts";

/**
 * 描述（木船僵尸系列 mid 22–26）：
 *   五种木船僵尸分别是普通/帽子/钢盔/龟壳/弓箭骷髅僵尸的水生版本，数值与原版一致，
 *   区别只有两点：habitats = ['water']（只能刷在水面行），boatMounted = true（始终挂木船表现）。
 *   装备逻辑沿用原版 Model（帽子/钢盔/龟甲/弓箭），不重复实现。
 *
 * 验收路径：
 *   1) 读取真实 preset 的 mid / nameKey / habitats / boatMounted / 基础数值。
 *   2) 用 harness 的 spawnMob 创建每种实体，检查 Model 初始化后的血量、速度、装备状态。
 *   3) 对比原版 definition，确认木船变体与原版数值完全相同。
 *   4) 在水面格/地面格创建实体，验证 boatMounted 时 attachSprites 内含 boat1/boat2。
 *
 * 预期结果：
 *   mid 依次为 22..26；全部 habitats=['water']、boatMounted=true；
 *   血量/速度/伤害与原版一致（普通300/20、帽子300/20、钢盔300/20、龟壳300/20、弓箭250/25）；
 *   帽子/钢盔/龟壳/弓箭变体各自装备已生效；地面格创建的木船僵尸仍带船层。
 *
 * 为什么：
 *   PresetMonsterModel 从 definition 读取 habitats/boatMounted 并写入可快照字段；
 *   MonsterEntity.checkAndAddBoat 在 boatMounted 为真时无条件添加木船前后两层，
 *   使水生僵尸即使出生在测试用的地面格也有完整表现。
 */

const cases = [
  { data: BoatZombieData, mid: 22, name: "BoatZombie", base: ZombieData, health: 300, damage: 20 },
  { data: BoatCapZombieData, mid: 23, name: "BoatCapZombie", health: 300, damage: 20 },
  { data: BoatHelmetZombieData, mid: 24, name: "BoatHelmetZombie", health: 300, damage: 20 },
  { data: BoatTurtleZombieData, mid: 25, name: "BoatTurtleZombie", health: 300, damage: 20 },
  { data: BoatSkeletonBowZombieData, mid: 26, name: "BoatSkeletonBowZombie", health: 250, damage: 25 },
];

test("五种木船僵尸的 mid / 名称 / 通行域 / 木船标记", () => {
  for (const { data, mid, name } of cases) {
    assert.equal(data.mid, mid);
    assert.equal(data.nameKey, name);
    assert.deepEqual(data.habitats, ["water"]);
    assert.equal(data.boatMounted, true);
  }
});

test("木船僵尸保留原版数值", () => {
  for (const { data, health, damage } of cases) {
    resetSim();
    const { model } = spawnMob(data, { col: 8, row: 2 });
    assert.equal(model.maxHealth, health, `mid=${data.mid} 血量`);
    assert.equal(model.health, health, `mid=${data.mid} 初始血量`);
    assert.equal(model.attackDamage, damage, `mid=${data.mid} 伤害`);
    assert.deepEqual(model.habitats, ["water"]);
    assert.equal(model.boatMounted, true);
  }
});

test("木船僵尸装备沿用原版逻辑", () => {
  const expectations = [
    [BoatCapZombieData, "helmetDef"],
    [BoatHelmetZombieData, "helmetDef"],
    [BoatTurtleZombieData, "helmetDef"],
    [BoatSkeletonBowZombieData, "weaponDef"],
  ];
  for (const [data, field] of expectations) {
    resetSim();
    const { model } = spawnMob(data, { col: 8, row: 2 });
    assert.ok(model[field], `mid=${data.mid} 应装备 ${field}`);
  }
});

test("boatMounted 在任意地形都挂载船层", () => {
  resetSim();
  setGridType(8, 2, "ground");
  const boat = spawnMob(BoatZombieData, { col: 8, row: 2 }).entity;
  boat.viewGroup = { addMultiple() {} };
  boat.checkAndAddBoat();
  assert.ok(boat.attachSprites.has("boat1"), "地面格也应挂木船后层");
  assert.ok(boat.attachSprites.has("boat2"), "地面格也应挂木船前层");

  resetSim();
  setGridType(8, 2, "ground");
  const plain = spawnMob(ZombieData, { col: 8, row: 2 }).entity;
  plain.viewGroup = { addMultiple() {} };
  plain.checkAndAddBoat();
  assert.equal(plain.attachSprites.has("boat1"), false, "普通僵尸地面格不挂船");
});

function hit(entity, amount, hitKind) {
  entity.updateBodyDamageStage ??= () => {};
  MonsterEntity.prototype.takeDamage.call(entity, amount, undefined, { model: { hitKind } });
}

test("木船 400 血 + 优先骑乘者：bullet/laser 打本体，爆炸同时打二者", () => {
  for (const data of cases.map(c => c.data)) {
    resetSim();
    const { model, entity } = spawnMob(data, { col: 8, row: 2 });
    assert.equal(model.mountHealth, 400, `mid=${data.mid} 木船血`);
    assert.equal(model.mountDamagePriority, "rider");

    hit(entity, 100, "bullet");
    assert.equal(model.mountHealth, 400, `mid=${data.mid} bullet 不扣坐骑`);
    assert.equal(model.health, model.maxHealth - 100, `mid=${data.mid} bullet 打本体`);

    resetSim();
    const boom = spawnMob(data, { col: 8, row: 2 });
    hit(boom.entity, 100, "explosion");
    assert.equal(boom.model.mountHealth, 300, `mid=${data.mid} 爆炸扣坐骑`);
    assert.equal(boom.model.health, boom.model.maxHealth - 100, `mid=${data.mid} 爆炸穿透本体`);
  }
});
