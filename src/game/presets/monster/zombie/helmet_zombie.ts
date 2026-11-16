import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import { EquippedMonsterEntity, withHelmetModel, type EquipmentDef } from "../../../models/equipment/Equipment";

export const STEEL_HELMET: EquipmentDef = {
  key: "attach/helmet",
  maxHealth: 1100,
  thresholds: [1100 * 2 / 3, 1100 / 3],
  hitSound: "ironHit",
  visual: { attachment: "fixed", depth: 13 },
};

/** 钢盔数值在 Model；Entity 只渲染。 */
export class HelmetZombieModel extends withHelmetModel(PresetMonsterModel) {
  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(entity: MonsterEntity): void {
    this.equipHelmet(entity, STEEL_HELMET);
  }
}

export class HelmetZombieEntity extends EquippedMonsterEntity {
  declare public model: HelmetZombieModel;

  public constructor(scene: Game, col: number, row: number, model: HelmetZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);  }

  protected createAnimController() {
    return createZombieAnimController("zombie", this.scene, this.x, this.y);
  }
}

export const HelmetZombieData = new HelmetZombieModel({
  mid: 3,
  nameKey: "HelmetZombie",
  level: 4,
  weight: () => 3000,
  leastWaveID: 1,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.HelmetZombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.HelmetZombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) => new HelmetZombieEntity(scene, col, row, model as HelmetZombieModel, waveID),
});
