import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import type { Game } from "../../../scenes/Game";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import { EquippedMonsterEntity, withWeaponModel, type EquipmentDef } from "../../../models/equipment/Equipment";

export const AXE_WEAPON: EquipmentDef = {
  key: "attach/hd_axe",
  maxHealth: 0,
  thresholds: [],
  visual: {
    attachment: "hand",
    swingAngle: -15,
    swingDuration: 200,
    depth: 13,
  },
};

/** 战斧挥动由 Model 攻击状态驱动；Entity 不再持有 attackTween 或武器 key。 */
export class VindicatorModel extends withWeaponModel(PresetMonsterModel) {
  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(entity: MonsterEntity): void {
    this.equipWeapon(entity, AXE_WEAPON);
  }
}

export class BaseVindicatorEntity extends EquippedMonsterEntity {
  declare public model: VindicatorModel;

  public constructor(scene: Game, col: number, row: number, model: VindicatorModel, waveID: number) {
    super(scene, col, row, model, waveID);  }

  protected createAnimController() {
    return createZombieAnimController("vindicator", this.scene, this.x, this.y);
  }
}

export class VindicatorEntity extends BaseVindicatorEntity { }

export const VindicatorData = new VindicatorModel({
  mid: 10,
  nameKey: "Vindicator",
  level: 9999,
  weight: () => 0,
  leastWaveID: 9999,
  maxHealth: 360,
  baseSpeed: MonsterSpeed.Vindicator,
  attackDamage: 32,
  attackInterval: ZombieAttackInterval.Vindicator,
  damageThresholds: [180],
  createEntity: (scene, col, row, model, waveID) => new VindicatorEntity(scene, col, row, model as VindicatorModel, waveID),
});
