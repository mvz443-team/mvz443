import type { Game } from "../../scenes/Game";
import type { BaseEntity } from "../core/BaseEntity";
import type { ModelHost } from "../../core/logic/LogicModel";
import type { MonsterEntity, MonsterDefinition } from "../entities/MonsterEntity";
import { PresetMonsterModel } from "../entities/MonsterEntity";
import { PositionManager } from "../../managers/view/PositionManager";
import PlantHelper from "../../utils/helper/PlantHelper";
import { readProjectileHitKind } from "../projectiles/ProjectileModels";

/**
 * 飞行中僵尸的 Model 基类：带一条"飞行载具"血条。
 *
 * 规则（全部是业务状态，自动进入快照）：
 * - `vehicleHealth > 0 && !vehicleBroken` → `flying = true`，悬吊在空中。
 * - 载具只抵挡 `bullet`（箭、雪球、烟花、矿车等）：子弹把载具打爆，
 *   本次伤害完全由载具承担，本体不受伤。
 * - `laser` / `explosion` 穿透载具：载具被打爆，同时本体受到这次伤害。
 * - 载具归零后 `flying = false`，恢复地面形态与地面攻击。
 */
export class FlyingMonsterModel extends PresetMonsterModel {
  /** 飞行载具当前血量。 */
  public vehicleHealth: number = 0;
  /** 飞行载具血量上限；0 表示该怪物没有载具。 */
  public readonly vehicleHealthMax: number;
  /** 载具是否已被打爆；与 vehicleHealth 一起防重复触发。 */
  public vehicleBroken: boolean = false;

  public constructor(def: MonsterDefinition) {
    super(def);
    this.vehicleHealthMax = def.vehicleHealth ?? 0;
  }

  /** 载具是否仍然在架（= 是否处于飞行形态）。 */
  public get hasVehicle(): boolean {
    return this.vehicleHealthMax > 0 && !this.vehicleBroken && this.vehicleHealth > 0;
  }

  public override initializeState(scene: Game, col: number, row: number, waveID: number): void {
    super.initializeState(scene, col, row, waveID);
    this.vehicleHealth = this.vehicleHealthMax;
    this.vehicleBroken = false;
    this.flying = this.hasVehicle;
  }

  /** 飞行中越过地面植物，不触发普攻。 */
  public override canStartAttack(target: BaseEntity): boolean {
    if (this.hasVehicle) return false;
    return super.canStartAttack(target);
  }

  /**
   * 载具伤害路由（Entity.takeDamage 的第一站）。
   *
   * @returns true 表示这次伤害已被载具完全吸收，本体不再结算。
   */
  public absorbVehicleDamage(
    entity: MonsterEntity,
    _amount: number,
    _dealer?: BaseEntity,
    source?: BaseEntity,
  ): boolean {
    if (!this.hasVehicle) return false;

    const hitKind = readProjectileHitKind(source);
    this.breakVehicle(entity);

    // 与坐骑统一语义：bullet/laser 由坐骑吸收，爆炸同时打爆载具并伤到本体。
    return hitKind !== "explosion";
  }

  /** 载具被打爆：气球消失、迫降、恢复地面形态。 */
  public breakVehicle(entity: MonsterEntity): void {
    if (this.vehicleBroken) return;
    this.vehicleHealth = 0;
    this.vehicleBroken = true;
    this.flying = false;
    entity.syncViewFromModel();
    this.onVehicleBroken(entity);
    entity.startMove();
  }

  /** 载具破碎钩子；子类可在此播放表现或调整数值。 */
  public onVehicleBroken(_entity: MonsterEntity): void { }

  /**
   * 落地后重新判定脚下植物。
   *
   * Rapier 的 sensor 只在 overlap-start 派发事件，飞行中越过植物时那一次
   * 碰撞已经消耗掉了，落地后必须主动补一次判定，否则会直接穿过植物。
   */
  public override onModelStep(host: ModelHost): void {
    const entity = host as MonsterEntity;
    if (this.hasVehicle || this.attackingId || this.isDying) return;
    if (entity.currentHealth <= 0) return;

    const row = entity.GetRow();
    const col = PositionManager.Instance.getColByX(entity.x);
    const plants = PlantHelper.GetPlantsInGrid(col, row);
    if (plants.length === 0) return;

    let target = plants[0];
    for (const plant of plants) {
      if (plant.currentHealth <= 0) continue;
      if (PlantHelper.IsMorePriorityPlant(target, plant)) target = plant;
    }
    if (target.currentHealth > 0) this.tryStartAttack(entity, target);
  }
}
