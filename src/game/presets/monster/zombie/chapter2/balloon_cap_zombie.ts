import type { Game } from "../../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import type { MonsterDefinition } from "../../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../../models/entities/MonsterEntity";
import { FlyingMonsterModel } from "../../../../models/monster/FlyingMonsterModel";
import { FlyingMonsterEntity } from "../../../../models/entities/FlyingMonsterEntity";
import { withHelmetModel, type EquipmentDef } from "../../../../models/equipment/Equipment";

const BALLOON_CAP_HELMET: EquipmentDef = {
  key: "attach/cap",
  maxHealth: 370,
  thresholds: [250, 125],
  hitSound: "leatherHit",
  visual: { attachment: "fixed", depth: 13 },
};

/**
 * 气球帽子僵尸（第 2 章）：飞行载具里装的是帽子僵尸。
 * 载具规则与气球僵尸完全一致，只是本体多一层 370 血的帽子护甲。
 */
export class BalloonCapZombieModel extends withHelmetModel(FlyingMonsterModel) {
  public constructor(def: MonsterDefinition) {
    super(def);
  }

  public override onCreate(entity: MonsterEntity): void {
    this.equipHelmet(entity, BALLOON_CAP_HELMET);
  }
}

export class BalloonCapZombieEntity extends FlyingMonsterEntity {
  declare public model: BalloonCapZombieModel;

  public constructor(scene: Game, col: number, row: number, model: BalloonCapZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const BalloonCapZombieData = new BalloonCapZombieModel({
  mid: 20,
  nameKey: "BalloonCapZombie",
  level: 3,
  weight: (waveID: number) => Math.min(1600, 300 + Math.max(waveID - 8, 0) * 100),
  leastWaveID: 4,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.BalloonCapZombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.BalloonCapZombie,
  damageThresholds: [150],
  isDefaultFlying: true,
  vehicleHealth: 1,
  createEntity: (scene, col, row, model, waveID) =>
    new BalloonCapZombieEntity(scene, col, row, model as BalloonCapZombieModel, waveID),
});
