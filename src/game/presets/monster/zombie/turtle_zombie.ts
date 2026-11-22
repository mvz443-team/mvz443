import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { EquipmentDef } from "../../../models/equipment/Equipment";
import { ZombieEntity, ZombieModel } from "./zombie";

export const TURTLE_SHELL: EquipmentDef = {
  key: "attach/turtle",
  maxHealth: 370,
  thresholds: [250, 125],
  damageScale: 0.5,
  hitSound: "leatherHit",
  visual: { attachment: "fixed", depth: 13 },
};

/** 龟甲破碎后的加速决策在 Model；Entity 只接收视图刷新。 */
export class TurtleZombieModel extends ZombieModel {
  public override onHeadBroken(entity: MonsterEntity): void {
    if (this.buffApplied) return;
    this.buffApplied = true;
    this.speed = this.originalSpeed * 2;
    if (!this.attackingId && !this.isFrozen) entity.startMove();
  }
}

export class TurtleZombieEntity extends ZombieEntity {
  declare public model: TurtleZombieModel;

  public constructor(scene: Game, col: number, row: number, model: TurtleZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
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
  baseAttackDamage: 20,
  attackInterval: ZombieAttackInterval.TurtleZombie,
  damageThresholds: [150],
  equipment: { head: TURTLE_SHELL },
  createEntity: (scene, col, row, model, waveID) => new TurtleZombieEntity(scene, col, row, model as TurtleZombieModel, waveID),
});
