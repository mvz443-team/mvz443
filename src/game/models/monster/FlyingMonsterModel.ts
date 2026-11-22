import type { Game } from "../../scenes/Game";
import type { BaseEntity } from "../core/BaseEntity";
import type { ModelHost } from "../../core/logic/LogicModel";
import type { MonsterEntity, MonsterDefinition } from "../entities/MonsterEntity";
import { MediumMonsterModel } from "./MediumMonsterModel";
import { PositionManager } from "../../managers/view/PositionManager";
import PlantHelper from "../../utils/helper/PlantHelper";
import { readProjectileHitKind } from "../projectiles/ProjectileModels";

/**
 * 飞行中僵尸的 Model 基类：气球作为 mount 槽，载具血量沿用 mountHealth。
 *
 * - bullet / laser：气球完全吸收，本体不受伤；
 * - explosion：气球和本体同时受伤；
 * - 气球破碎后 flying = false，恢复地面形态。
 */
export class FlyingMonsterModel extends MediumMonsterModel {
  /** 兼容旧字段：飞行载具当前血量。 */
  public get vehicleHealth(): number { return this.mountHealth; }
  public set vehicleHealth(value: number) { this.mountHealth = value; }

  /** 兼容旧字段：飞行载具血量上限。 */
  public get vehicleHealthMax(): number { return this.mountHealthMax; }

  /** 兼容旧字段：载具是否已被打爆。 */
  public get vehicleBroken(): boolean { return this.mountBroken; }
  public set vehicleBroken(value: boolean) { this.mountBroken = value; }

  public constructor(def: MonsterDefinition) {
    super(def);
  }

  /** 载具是否仍然在架（= 是否处于飞行形态）。 */
  public get hasVehicle(): boolean {
    return this.hasMount();
  }

  public override initializeState(scene: Game, col: number, row: number, waveID: number): void {
    super.initializeState(scene, col, row, waveID);
    this.flying = this.hasVehicle;
  }

  /** 飞行中越过地面植物，不触发普攻。 */
  public override canStartAttack(target: BaseEntity): boolean {
    if (this.hasVehicle) return false;
    return super.canStartAttack(target);
  }

  /**
   * 兼容旧接口：Entity.takeDamage 的第一站。
   * @returns true 表示本次伤害由载具完全吸收，本体不再结算。
   */
  public absorbVehicleDamage(
    entity: MonsterEntity,
    amount: number,
    _dealer?: BaseEntity,
    source?: BaseEntity,
  ): boolean {
    if (!this.hasVehicle) return false;

    const hitKind = readProjectileHitKind(source);
    this.mountHealth = Math.max(0, this.mountHealth - amount);
    if (this.mountHealth === 0) this.breakMount(entity);

    // bullet/laser 由载具吸收；explosion 同时打爆载具并伤到本体。
    return hitKind !== "explosion";
  }

  /** 兼容旧接口：载具被打爆。 */
  public breakVehicle(entity: MonsterEntity): void {
    this.breakMount(entity);
  }

  /** 载具破碎钩子；子类可在此播放表现或调整数值。 */
  public onVehicleBroken(_entity: MonsterEntity): void { }

  public override onMountBroken(entity: MonsterEntity): void {
    this.flying = false;
    this.onVehicleBroken(entity);
  }

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
