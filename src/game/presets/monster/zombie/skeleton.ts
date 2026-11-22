import { MediumMonsterModel } from "../../../models/monster/MediumMonsterModel";
import { MediumMonsterEntity } from "../../../models/entities/MediumMonsterEntity";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";

export class SkeletonModel extends MediumMonsterModel { }

export class BaseSkeletonEntity extends MediumMonsterEntity {
  public constructor(scene: Game, col: number, row: number, model: MediumMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected createAnimController() {
    return createZombieAnimController("skeleton", this.scene, this.x, this.y);
  }
}

export class SkeletonEntity extends BaseSkeletonEntity {
  public constructor(scene: Game, col: number, row: number, model: SkeletonModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const SkeletonData = new SkeletonModel({
  mid: 6,
  nameKey: "Skeleton",
  level: 999,
  weight: () => 0,
  leastWaveID: 9999,
  maxHealth: 250,
  baseSpeed: MonsterSpeed.Skeleton,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Skeleton,
  damageThresholds: [100],
  createEntity: (scene, col, row, model, waveID) => new SkeletonEntity(scene, col, row, model as SkeletonModel, waveID),
});
