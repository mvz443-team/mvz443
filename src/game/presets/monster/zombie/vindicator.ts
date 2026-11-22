import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import type { Game } from "../../../scenes/Game";
import { MediumMonsterModel } from "../../../models/monster/MediumMonsterModel";
import { MediumMonsterEntity } from "../../../models/entities/MediumMonsterEntity";
import type { EquipmentDef } from "../../../models/equipment/Equipment";

export const AXE_WEAPON: EquipmentDef = {
  key: "attach/hd_axe",
  maxHealth: 450,
  thresholds: [],
  weaponDamage: 12,
  visual: {
    attachment: "hand",
    swingAngle: -15,
    swingDuration: 200,
    depth: 13,
  },
};

/** 战斧挥动由 Model 攻击状态驱动；Entity 不再持有 attackTween 或武器 key。 */
export class VindicatorModel extends MediumMonsterModel { }

export class BaseVindicatorEntity extends MediumMonsterEntity {
  declare public model: VindicatorModel;

  public constructor(scene: Game, col: number, row: number, model: VindicatorModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

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
  baseAttackDamage: 20,
  attackInterval: ZombieAttackInterval.Vindicator,
  damageThresholds: [180],
  equipment: { mainHand: AXE_WEAPON },
  createEntity: (scene, col, row, model, waveID) => new VindicatorEntity(scene, col, row, model as VindicatorModel, waveID),
});
