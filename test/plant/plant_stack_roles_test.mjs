import test from "node:test";
import assert from "node:assert/strict";
import {
  resetSim,
  spawnPlant,
  setGridType,
} from "../harness/sim.mjs";
import { LilyData } from "../../src/game/presets/plant/chapter1/lily.ts";
import { TntMinesData } from "../../src/game/presets/plant/chapter1/tnt_mines.ts";
import { PumpkinPassportData } from "../../src/game/presets/plant/chapter2/pumpkin_passport.ts";
import { DispenserData } from "../../src/game/presets/plant/chapter1/dispenser.ts";
import {
  isCarrierPlantPid,
  isShieldPlantPid,
  pickShieldPlant,
  pickStarShardsTarget,
  registerPlantStackRole,
  resetPlantStackRoles,
  stackRoleOfPid,
} from "../../src/game/utils/helper/PlantTargeting.ts";
import PlantHelper from "../../src/game/utils/helper/PlantHelper.ts";

/**
 * 描述（植物属性解耦 / 错落三态）：
 *   植物的"能种在哪"（allowedPlantSlots）与"在同格里扮演什么角色"（stackRole）是两套正交属性。
 *   仅地面（TNT 地雷）、仅水中（睡莲）、仅空中（船，兼容常量）由 Model 白名单表达；
 *   错落三态 carrier（承载物）/ shield（护罩）/ normal（正常植物）由 PlantModel.stackRole 表达。
 *   目标选择、伤害路由与种植判定一律读属性，pid 表仅在 Model 未注册时回落。
 *
 * 验收路径：
 *   1) 读取真实 preset 的 allowedPlantSlots / stackRole 默认值与覆写值。
 *   2) 注册/清空 stackRole 缓存，验证 pid 查询走属性而非硬编码表。
 *   3) 用 harness 的 GridManager 替身构造 water/ground 格，调用真实 PlantHelper.CanPlantInGrid。
 *   4) 用带 stackRole 的伪实体驱动 pickShieldPlant / pickStarShardsTarget。
 *
 * 预期结果：
 *   睡莲 allowedPlantSlots=['water']、stackRole='carrier'；地雷 ['ground']、normal；
 *   南瓜护照 stackRole='shield'；豌豆射手两者皆默认（null / normal）。
 *   注册 pid=999 为 shield 后 isShieldPlantPid(999)=true，reset 后回落为 false。
 *   睡莲只能种水格、地雷只能种地面、护罩同格互斥、承载物上可叠种普通植物。
 *   星碎目标：shell 在 down、inner 在 up；护盾伤害由 pickShieldPlant 命中。
 *
 * 为什么：
 *   PlantTargeting 的 pid→role 缓存只由 PlantLibrary 初始化写入，是静态配置不进哈希；
 *   CanPlantInGrid 通过传入的 model 读 allowedPlantSlots，彻底去掉 lily/boat 的 pid 硬编码分支；
 *   stackRoleOf 优先读实体的 stackRole getter（转发 Model），回落到 pid 表以兼容测试替身。
 */

test("真实 preset 的种植白名单与错落角色", () => {
  assert.deepEqual(LilyData.allowedPlantSlots, ["water"]);
  assert.equal(LilyData.stackRole, "carrier");

  assert.deepEqual(TntMinesData.allowedPlantSlots, ["ground"]);
  assert.equal(TntMinesData.stackRole, "normal");

  assert.equal(PumpkinPassportData.allowedPlantSlots, null);
  assert.equal(PumpkinPassportData.stackRole, "shield");

  assert.equal(DispenserData.allowedPlantSlots, null);
  assert.equal(DispenserData.stackRole, "normal");
});

test("stackRole 缓存以 Model 属性为准，reset 后回落", () => {
  resetPlantStackRoles();
  assert.equal(isShieldPlantPid(19), true, "回落表仍识别南瓜护照");
  assert.equal(isShieldPlantPid(999), false);

  registerPlantStackRole(999, "shield");
  assert.equal(isShieldPlantPid(999), true);
  assert.equal(stackRoleOfPid(999), "shield");

  resetPlantStackRoles();
  assert.equal(isShieldPlantPid(999), false);
  assert.equal(isCarrierPlantPid(6), true);
});

test("CanPlantInGrid：仅水中/仅地面由属性决定", () => {
  resetSim();
  resetPlantStackRoles();
  registerPlantStackRole(LilyData.pid, LilyData.stackRole);
  registerPlantStackRole(PumpkinPassportData.pid, PumpkinPassportData.stackRole);

  setGridType(0, 0, "water");
  setGridType(1, 0, "ground");

  assert.equal(
    PlantHelper.CanPlantInGrid([], LilyData.pid, { type: "water" }, LilyData),
    true,
    "睡莲可种水格",
  );
  assert.equal(
    PlantHelper.CanPlantInGrid([], LilyData.pid, { type: "ground" }, LilyData),
    false,
    "睡莲不可种地面",
  );
  assert.equal(
    PlantHelper.CanPlantInGrid([], TntMinesData.pid, { type: "ground" }, TntMinesData),
    true,
    "地雷可种地面",
  );
  assert.equal(
    PlantHelper.CanPlantInGrid([], TntMinesData.pid, { type: "water" }, TntMinesData),
    false,
    "地雷不可种水面",
  );
});

test("CanPlantInGrid：承载物上可叠种，护罩同格互斥", () => {
  resetSim();
  resetPlantStackRoles();
  registerPlantStackRole(LilyData.pid, LilyData.stackRole);
  registerPlantStackRole(PumpkinPassportData.pid, PumpkinPassportData.stackRole);

  const lily = spawnPlant(LilyData, { level: 1, col: 0, row: 0 });
  const shield = spawnPlant(PumpkinPassportData, { level: 1, col: 0, row: 0 });

  assert.equal(
    PlantHelper.CanPlantInGrid([lily.entity], DispenserData.pid, { type: "water" }, DispenserData),
    true,
    "睡莲上可叠种普通植物",
  );
  assert.equal(
    PlantHelper.CanPlantInGrid([shield.entity], PumpkinPassportData.pid, { type: "ground" }, PumpkinPassportData),
    false,
    "同格不能有两株护罩",
  );
});

test("错落三态驱动星碎目标与护盾承伤", () => {
  const inner = { pid: 1, currentHealth: 100, stackRole: "normal" };
  const shell = { pid: 19, currentHealth: 200, stackRole: "shield" };
  const carrier = { pid: 6, currentHealth: 300, stackRole: "carrier" };

  assert.equal(pickShieldPlant([inner, shell, carrier], inner), shell);
  assert.equal(pickStarShardsTarget([carrier, inner, shell], "up"), inner);
  assert.equal(pickStarShardsTarget([carrier, inner, shell], "down"), shell);
  assert.equal(pickStarShardsTarget([carrier], "down"), carrier, "只剩承载物时兜底");
});
