import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import {
  EquippedMonsterEntity,
  withHelmetModel,
  withWeaponModel,
} from "../../../models/equipment/Equipment";
import { STEEL_HELMET } from "./helmet_zombie";
import { PICKAXE_WEAPON } from "./miner_zombie";

const MinerHelmetModelBase = withWeaponModel(withHelmetModel(PresetMonsterModel));

/** 同时拥有钢盔与镐子；两种能力都只由 Model 定义数据。 */
export class MinerHelmetZombieModel extends MinerHelmetModelBase {
  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(entity: MonsterEntity): void {
    this.equipHelmet(entity, STEEL_HELMET);
    this.equipWeapon(entity, PICKAXE_WEAPON);
  }
}

export class MinerHelmetZombieEntity extends EquippedMonsterEntity {
  declare public model: MinerHelmetZombieModel;

  public constructor(scene: Game, col: number, row: number, model: MinerHelmetZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);  }

  protected createAnimController() {
    return createZombieAnimController("zombie", this.scene, this.x, this.y);
  }
}

export const MinerHelmetZombieData = new MinerHelmetZombieModel({
  mid: 5,
  nameKey: "MinerHelmetZombie",
  level: 5,
  weight: () => 2000,
  leastWaveID: 13,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.MinerHelmetZombie,
  attackDamage: 60,
  attackInterval: ZombieAttackInterval.MinerHelmetZombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) => new MinerHelmetZombieEntity(scene, col, row, model as MinerHelmetZombieModel, waveID),
});
