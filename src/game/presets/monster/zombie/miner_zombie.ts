import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import type { EquipmentDef } from "../../../models/equipment/Equipment";
import { ZombieEntity, ZombieModel } from "./zombie";

export const PICKAXE_WEAPON: EquipmentDef = {
  key: "attach/hd_pickaxe",
  maxHealth: 20,
  thresholds: [],
  weaponDamage: 40,
  visual: {
    attachment: "hand",
    swingAngle: -15,
    swingDuration: 200,
    depth: 13,
  },
};

/** 镐子是武器能力；挥动由 Model 的攻击状态驱动，Entity 只播放 Tween。 */
export class MinerZombieModel extends ZombieModel { }

export class MinerZombieEntity extends ZombieEntity {
  declare public model: MinerZombieModel;

  public constructor(scene: Game, col: number, row: number, model: MinerZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
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
  baseAttackDamage: 20,
  attackInterval: ZombieAttackInterval.MinerZombie,
  damageThresholds: [150],
  equipment: { mainHand: PICKAXE_WEAPON },
  createEntity: (scene, col, row, model, waveID) => new MinerZombieEntity(scene, col, row, model as MinerZombieModel, waveID),
});
