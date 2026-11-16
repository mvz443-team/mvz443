/**
 * 各实体族的逻辑寄存器声明表。
 *
 * 约定：
 * - 只有会影响模拟结果的数值/布尔/枚举字段进入寄存器；
 * - 位置由物理世界负责，不进入寄存器；
 * - 实体引用、Set 等关系型状态另行通过 captureLogicState 显式序列化；
 * - 具体 Model 可以覆盖 logicSchema 追加自定义寄存器。
 */

import { LogicRegisterDecl, RegisterSchema } from "./LogicRegister";

const f64 = (name: string, defaultValue = 0): LogicRegisterDecl => ({ name, type: "f64", default: defaultValue });
const i32 = (name: string, defaultValue = 0): LogicRegisterDecl => ({ name, type: "i32", default: defaultValue });
const bool = (name: string, defaultValue = false): LogicRegisterDecl => ({ name, type: "bool", default: defaultValue });

const COMBAT_COMMON: LogicRegisterDecl[] = [
  f64("currentHealth"),
  f64("maxHealth"),
  bool("isTiny"),
];

const PLANT_SPECIFIC: LogicRegisterDecl[] = [
  i32("level", 1),
  bool("isSleeping"),
  f64("shieldHealth"),
  f64("damagedSum"),
  bool("inBruteShoot"),
  f64("isLightning"),
  bool("isBuried"),
  bool("hasExploded"),
  bool("hasTriggered"),
  bool("canActivateFromSleep"),
  f64("fuse"),
  f64("explosionDamage"),
];

const MONSTER_SPECIFIC: LogicRegisterDecl[] = [
  i32("waveID", -1),
  f64("health"),
  f64("speed"),
  f64("originalSpeed"),
  bool("isFlying"),
  bool("isInVoid"),
  bool("isDying"),
  bool("isFrozen"),
  bool("isStop"),
  bool("carryStarShards"),
  i32("carriedStarShards"),
  i32("starShardsDropped"),
  f64("offsetX"),
  f64("offsetY"),
  i32("currentStage"),
  f64("armorHealth"),
  bool("armorBroken"),
  bool("hasTriggered"),
  f64("lastSkill"),
  i32("callCount"),
  f64("shellHealth"),
  bool("broken"),
  bool("buffApplied"),
  bool("hasStick"),
  f64("vaultTargetX"),
  bool("isAttacking"),
  bool("isHidden"),
  bool("flashTriggered"),
];

const OBSTACLE_SPECIFIC: LogicRegisterDecl[] = [
  f64("health"),
];

const PROJECTILE_SPECIFIC: LogicRegisterDecl[] = [
  f64("currentDamage"),
  i32("currentPenetrate"),
  i32("penetratePower"),
  f64("penetratedPunish"),
  f64("traveledDistanceX"),
  f64("prevX"),
  f64("maxDistanceX"),
  bool("bounceable"),
  bool("skipTiny"),
  f64("speed"),
  f64("debuffDuration"),
];

export const PLANT_LOGIC_SCHEMA = new RegisterSchema([...COMBAT_COMMON, ...PLANT_SPECIFIC]);
export const MONSTER_LOGIC_SCHEMA = new RegisterSchema([...COMBAT_COMMON, ...MONSTER_SPECIFIC]);
export const OBSTACLE_LOGIC_SCHEMA = new RegisterSchema([...COMBAT_COMMON, ...OBSTACLE_SPECIFIC]);
export const PROJECTILE_LOGIC_SCHEMA = new RegisterSchema([...COMBAT_COMMON, ...PROJECTILE_SPECIFIC]);

export const EMPTY_LOGIC_SCHEMA = new RegisterSchema([]);

/**
 * 关系型状态（实体引用/Set）不进入寄存器，按族显式声明。
 * 这些字段会被序列化为实体快照 id，恢复时再解析回存活实体。
 */
// colliderZombie 是 Phaser Arcade Collider（非实体），不能进快照。
export const PLANT_RELATION_FIELDS = ["underAttackBy", "pendingFlyingMonsters"] as const;
export const MONSTER_RELATION_FIELDS = [
  "attacking",
  "preAttackedPlant",
  "attackedPlants",
  "underAttackBy",
  "vaultCollisionTarget",
] as const;
export const OBSTACLE_RELATION_FIELDS = ["summoner", "underAttackBy"] as const;
export const PROJECTILE_RELATION_FIELDS = ["dealer", "hasAttacked"] as const;
export const DEFAULT_RELATION_FIELDS = ["underAttackBy"] as const;

/** 具备可快照 PRNG 状态的字段（seedrandom state() 接口）。 */
export const PLANT_PRNG_FIELDS = ["random"] as const;
export const MONSTER_PRNG_FIELDS = ["random"] as const;
