/**
 * 关系型字段（实体引用/Set）与 PRNG 字段声明。
 * 这些不是寄存器：它们由 EntitySnapshot 做独立的引用编解码。
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
export const PROJECTILE_RELATION_FIELDS = ["dealer", "hasAttackedSet", "hasPenetrated"] as const;
export const DEFAULT_RELATION_FIELDS = ["underAttackBy"] as const;

export const PLANT_PRNG_FIELDS = ["random"] as const;
export const MONSTER_PRNG_FIELDS = ["random"] as const;
