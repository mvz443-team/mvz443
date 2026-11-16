import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import { EquippedMonsterEntity, withHelmetModel, type EquipmentDef } from "../../../models/equipment/Equipment";

const TURTLE_SHELL: EquipmentDef = {
  key: "attach/turtle",
  maxHealth: 370,
  thresholds: [250, 125],
  damageScale: 0.5,
  hitSound: "leatherHit",
  visual: { attachment: "fixed", depth: 13 },
};

/** 龟甲破碎后的加速决策在 Model；Entity 只接收视图刷新。 */
export class TurtleZombieModel extends withHelmetModel(PresetMonsterModel) {
  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(entity: MonsterEntity): void {
    this.equipHelmet(entity, TURTLE_SHELL);
  }

  public override onHelmetBroken(entity: MonsterEntity): void {
    if (this.buffApplied) return;
    this.buffApplied = true;
    entity.speed = entity.originalSpeed * 2;
    if (!entity.attacking && !entity.isFrozen) entity.startMove();
  }
}

export class TurtleZombieEntity extends EquippedMonsterEntity {
  declare public model: TurtleZombieModel;

  public constructor(scene: Game, col: number, row: number, model: TurtleZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);  }

  protected createAnimController() {
    return createZombieAnimController("zombie", this.scene, this.x, this.y);
  }
}

export const TurtleZombieData = new TurtleZombieModel({
  mid: 14,
  nameKey: "TurtleZombie",
  level: 2,
  weight: () => 1200,
  leastWaveID: 4,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.TurtleZombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.TurtleZombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) => new TurtleZombieEntity(scene, col, row, model as TurtleZombieModel, waveID),
});
