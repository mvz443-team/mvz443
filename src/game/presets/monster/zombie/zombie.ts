import { ArmorMonsterEntity, PresetMonsterModel, StagedBodyMonsterEntity } from "../../../models/entities/MonsterEntity";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";


export class BaseZombieEntity extends StagedBodyMonsterEntity {
  protected damageThresholds = [150];

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected createAnimController() {
    return createZombieAnimController("zombie", this.scene, this.x, this.y);
  }
}

export class BaseZombieArmorEntity extends ArmorMonsterEntity {
  protected damageThresholds = [150];

  protected createAnimController() {
    return createZombieAnimController("zombie", this.scene, this.x, this.y);
  }
}

export class ZombieEntity extends BaseZombieEntity {
  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const ZombieData = new PresetMonsterModel({
  mid: 1,
  nameKey: "Zombie",
  level: 1,
  weight: (waveID) => Math.max(400, 4000 - (waveID - 4) * 180),
  leastWaveID: 0,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.Zombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Zombie,
  createEntity: (scene, col, row, model, waveID) => new ZombieEntity(scene, col, row, model, waveID),
});
