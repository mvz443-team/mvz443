import type { Game } from "../../../../scenes/Game";
import { BOW_WEAPON, SkeletonBowModel } from "../../../../models/entities/BaseSkeletonBowEntity";
import { SkeletonBowEntity } from "../skeleton_bow";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";

/** 木船弓箭骷髅：复用远程射箭逻辑，仅改为水生 + 木船。 */
export const BoatSkeletonBowZombieData = new SkeletonBowModel({
  mid: 26,
  nameKey: "BoatSkeletonBowZombie",
  level: 2,
  weight: (waveID) => Math.max(400, 1200 - (waveID - 16) * 80),
  leastWaveID: 10,
  habitats: ["water"],
  boatMounted: true,
  mountHealth: 400,
  mountDamagePriority: "rider",
  maxHealth: 250,
  baseSpeed: MonsterSpeed.SkeletonBow,
  attackDamage: 25,
  attackInterval: ZombieAttackInterval.SkeletonBow,
  equipment: { mainHand: BOW_WEAPON },
  createEntity: (scene: Game, col: number, row: number, model, waveID: number) =>
    new SkeletonBowEntity(scene, col, row, model as SkeletonBowModel, waveID),
});
