import type { Game } from "../../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import type { MonsterDefinition, MonsterEntity } from "../../../../models/entities/MonsterEntity";
import type { ModelHost } from "../../../../core/logic/LogicModel";
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

  /**
   * 飞行到移动方向上的最后一格（向左即 col 0）时，气球主动死亡降落。
   *
   * 与"被子弹打爆"共用 `breakVehicle → breakMount` 路径：`mountHealth` /
   * `mountBroken` / `flying` 都是快照字段。回滚到进入最后一格之前会重新触发，
   * 回滚到之后则保持已降落，无需任何 Entity 自有状态或表现层时钟。
   */
  public override onModelStep(host: ModelHost): void {
    const entity = host as MonsterEntity;
    if (this.hasVehicle && !this.isDying && entity.currentHealth > 0
      && this.hasEnteredLastCellInMoveDirection(entity)) {
      this.breakVehicle(entity);
    }
    super.onModelStep(host);
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
