import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import { EquippedMonsterEntity, withHelmetModel, type EquipmentDef } from "../../../models/equipment/Equipment";

const CAP_HELMET: EquipmentDef = {
  key: "attach/cap",
  maxHealth: 370,
  thresholds: [250, 125],
  hitSound: "leatherHit",
  visual: { attachment: "fixed", depth: 13 },
};

/** 帽子数值与破碎规则定义在 Model；Entity 只按 Model 状态渲染帽子。 */
export class CapZombieModel extends withHelmetModel(PresetMonsterModel) {
  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(entity: MonsterEntity): void {
    this.equipHelmet(entity, CAP_HELMET);
  }
}

export class CapZombieEntity extends EquippedMonsterEntity {
  declare public model: CapZombieModel;

  public constructor(scene: Game, col: number, row: number, model: CapZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);  }

  protected createAnimController() {
    return createZombieAnimController("zombie", this.scene, this.x, this.y);
  }
}

export const CapZombieData = new CapZombieModel({
  mid: 2,
  nameKey: "CapZombie",
  level: 2,
  weight: (waveID) => Math.max(800, 4000 - (waveID - 4) * 150),
  leastWaveID: 0,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.CapZombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.CapZombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) => new CapZombieEntity(scene, col, row, model as CapZombieModel, waveID),
});
