import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import type { EquipmentDef } from "../../../models/equipment/Equipment";
import { ZombieEntity, ZombieModel } from "./zombie";

export const STEEL_HELMET: EquipmentDef = {
  key: "attach/helmet",
  maxHealth: 1100,
  thresholds: [1100 * 2 / 3, 1100 / 3],
  hitSound: "ironHit",
  visual: { attachment: "fixed", depth: 13 },
};

/** 钢盔数值在 Model；Entity 只渲染。 */
export class HelmetZombieModel extends ZombieModel { }

export class HelmetZombieEntity extends ZombieEntity {
  declare public model: HelmetZombieModel;

  public constructor(scene: Game, col: number, row: number, model: HelmetZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
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
  equipment: { head: STEEL_HELMET },
  createEntity: (scene, col, row, model, waveID) => new HelmetZombieEntity(scene, col, row, model as HelmetZombieModel, waveID),
});
