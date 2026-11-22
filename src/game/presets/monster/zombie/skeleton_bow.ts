import { BOW_WEAPON, SkeletonBowModel, BaseSkeletonBowEntity } from "../../../models/entities/BaseSkeletonBowEntity";
import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";


export class SkeletonBowEntity extends BaseSkeletonBowEntity {
  public constructor(scene: Game, col: number, row: number, model: SkeletonBowModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const SkeletonBowData = new SkeletonBowModel({
  mid: 7,
  nameKey: "SkeletonBow",
  level: 2,
  weight: (waveID) => Math.max(800, 1500 - (waveID - 15) * 100),
  leastWaveID: 7,
  maxHealth: 250,
  baseSpeed: MonsterSpeed.SkeletonBow,
  baseAttackDamage: 25,
  attackInterval: ZombieAttackInterval.SkeletonBow,
  arrowDamage: 70,
  arrowInterval: 3500,
  equipment: { mainHand: BOW_WEAPON },
  createEntity: (scene, col, row, model, waveID) => new SkeletonBowEntity(scene, col, row, model as SkeletonBowModel, waveID),
});
