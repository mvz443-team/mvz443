import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { ZombieEntity, ZombieModel } from "./zombie";
import { STEEL_HELMET } from "./helmet_zombie";
import { PICKAXE_WEAPON } from "./miner_zombie";

/** 同时拥有钢盔与镐子；两种能力都只由 Model 定义数据。 */
export class MinerHelmetZombieModel extends ZombieModel { }

export class MinerHelmetZombieEntity extends ZombieEntity {
  declare public model: MinerHelmetZombieModel;

  public constructor(scene: Game, col: number, row: number, model: MinerHelmetZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const MinerHelmetZombieData = new MinerHelmetZombieModel({
  mid: 5,
  nameKey: "MinerHelmetZombie",
  level: 5,
  weight: () => 2000,
  leastWaveID: 13,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.MinerHelmetZombie,
  attackDamage: 60,
  attackInterval: ZombieAttackInterval.MinerHelmetZombie,
  damageThresholds: [150],
  equipment: { head: STEEL_HELMET, mainHand: PICKAXE_WEAPON },
  createEntity: (scene, col, row, model, waveID) => new MinerHelmetZombieEntity(scene, col, row, model as MinerHelmetZombieModel, waveID),
});
