import type { Game } from "../../scenes/Game";
import type { BaseEntity } from "../core/BaseEntity";
import { EquippedMonsterEntity } from "../equipment/Equipment";
import { createFlyingZombieAnimController } from "../monster/anims/LegacyMonsterAnimControllers";
import type { IMonsterAnimController } from "../monster/anims/IMonsterAnimController";
import type { FlyingMonsterModel } from "../monster/FlyingMonsterModel";

/**
 * 飞行中僵尸的 Entity 基类。
 *
 * 伤害路由固定为：飞行载具 → shield → helmet → 本体。
 * 载具状态、飞行状态、血量全部在 Model；Entity 只做视图与物理胶水。
 */
export abstract class FlyingMonsterEntity extends EquippedMonsterEntity {
  declare public model: FlyingMonsterModel;

  public constructor(scene: Game, col: number, row: number, model: FlyingMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected createAnimController(): IMonsterAnimController {
    return createFlyingZombieAnimController(this.scene, this.x, this.y);
  }

  protected override buildView(): void {
    super.buildView();
    this.syncVehicleView();
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    // 载具先结算：子弹被完全吸收，激光/爆炸穿透到后面的护甲与本体。
    if (this.model.absorbVehicleDamage(this, amount, dealer, source)) return;
    super.takeDamage(amount, dealer, source);
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    this.syncVehicleView();
  }

  /** 视图单向跟随 Model：载具在架 = 悬吊姿态，破碎 = 站立姿态。 */
  protected syncVehicleView(): void {
    this.animController?.setAirborne?.(this.model.hasVehicle);
  }
}
