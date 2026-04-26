import { PresetMonsterModel, StagedBodyMonsterEntity } from "../../../models/entities/MonsterEntity";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";


export class BaseSkeletonEntity extends StagedBodyMonsterEntity {
  protected damageThresholds = [100];

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected createAnimController() {
    return createZombieAnimController("skeleton", this.scene, this.x, this.y);
  }
}

export class SkeletonEntity extends BaseSkeletonEntity {
  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const SkeletonData = new PresetMonsterModel({
  mid: 6,
  nameKey: "Skeleton",
  level: 999,
  weight: () => 0,
  leastWaveID: 9999,
  maxHealth: 250,
  baseSpeed: MonsterSpeed.Skeleton,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Skeleton,
  createEntity: (scene, col, row, model, waveID) => new SkeletonEntity(scene, col, row, model, waveID),
});
