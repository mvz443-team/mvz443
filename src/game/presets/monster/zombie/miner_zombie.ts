import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import { EquippedMonsterEntity, withWeaponModel, type EquipmentDef } from "../../../models/equipment/Equipment";

export const PICKAXE_WEAPON: EquipmentDef = {
  key: "attach/hd_pickaxe",
  maxHealth: 0,
  thresholds: [],
  visual: {
    attachment: "hand",
    swingAngle: -15,
    swingDuration: 200,
    depth: 13,
  },
};

/** 镐子是武器能力；挥动由 Model 的攻击状态驱动，Entity 只播放 Tween。 */
export class MinerZombieModel extends withWeaponModel(PresetMonsterModel) {
  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(entity: MonsterEntity): void {
    this.equipWeapon(entity, PICKAXE_WEAPON);
  }
}

export class MinerZombieEntity extends EquippedMonsterEntity {
  declare public model: MinerZombieModel;

  public constructor(scene: Game, col: number, row: number, model: MinerZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);  }

  protected createAnimController() {
    return createZombieAnimController("zombie", this.scene, this.x, this.y);
  }
}

export const MinerZombieData = new MinerZombieModel({
  mid: 4,
  nameKey: "MinerZombie",
  level: 2,
  weight: () => 2500,
  leastWaveID: 2,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.MinerZombie,
  attackDamage: 60,
  attackInterval: ZombieAttackInterval.MinerZombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) => new MinerZombieEntity(scene, col, row, model as MinerZombieModel, waveID),
});
