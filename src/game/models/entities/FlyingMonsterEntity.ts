import type { Game } from "../../scenes/Game";
import { MediumMonsterEntity } from "./MediumMonsterEntity";
import { createFlyingZombieAnimController } from "../monster/anims/LegacyMonsterAnimControllers";
import type { IMonsterAnimController } from "../monster/anims/IMonsterAnimController";
import type { FlyingMonsterModel } from "../monster/FlyingMonsterModel";

/**
 * 飞行中僵尸的 Entity 基类。
 * 伤害路由统一由 MediumMonsterModel 处理；Entity 只做视图与物理胶水。
 */
export abstract class FlyingMonsterEntity extends MediumMonsterEntity {
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

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    this.syncVehicleView();
  }

  /** 视图单向跟随 Model：载具在架 = 悬吊姿态，破碎 = 站立姿态。 */
  protected syncVehicleView(): void {
    this.animController?.setAirborne?.(this.model.hasVehicle);
  }
}
