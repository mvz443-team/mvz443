import type { Game } from "../../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import type { MonsterDefinition } from "../../../../models/entities/MonsterEntity";
import { FlyingMonsterModel } from "../../../../models/monster/FlyingMonsterModel";
import { FlyingMonsterEntity } from "../../../../models/entities/FlyingMonsterEntity";

/**
 * 气球僵尸（第 2 章）。
 *
 * - 默认 `flying = true`，由飞行载具（3 个红气球）支撑；载具只有 1 点血。
 * - 子弹打中载具：气球爆炸并迫降，本次伤害由载具完全承担，僵尸本体不受伤。
 * - 爆炸 / 激光打中：气球爆炸，同时僵尸本体受到这次伤害。
 * - 载具归零后 `flying = false`，变成普通地面僵尸（300 血、20 伤害）。
 */
export class BalloonZombieModel extends FlyingMonsterModel {
  public constructor(def: MonsterDefinition) {
    super(def);
  }
}

export class BalloonZombieEntity extends FlyingMonsterEntity {
  declare public model: BalloonZombieModel;

  public constructor(scene: Game, col: number, row: number, model: BalloonZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const BalloonZombieData = new BalloonZombieModel({
  mid: 19,
  nameKey: "BalloonZombie",
  level: 2,
  weight: (waveID: number) => Math.min(2200, 600 + Math.max(waveID - 4, 0) * 120),
  leastWaveID: 0,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.BalloonZombie,
  baseAttackDamage: 20,
  attackInterval: ZombieAttackInterval.BalloonZombie,
  damageThresholds: [150],
  isDefaultFlying: true,
  vehicleHealth: 1,
  createEntity: (scene, col, row, model, waveID) =>
    new BalloonZombieEntity(scene, col, row, model as BalloonZombieModel, waveID),
});
