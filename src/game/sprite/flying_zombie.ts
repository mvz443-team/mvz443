import { PositionManager } from "../managers/view/PositionManager";
import { Game } from "../scenes/Game";
import DepthHelper from "../utils/helper/DepthHelper";
import IZombieAnim, { ZombieAnimProps } from "./zombie";

/**
 * 飞行中僵尸的动画。
 *
 * 视觉构成（只由 Model 的 `hasVehicle` 单向驱动）：
 * - 上方：飞行载具（3 个红气球 + 绳，`attach/balloon`）
 * - 下方：整套僵尸纸片零件绕躯体中心刚性旋转 90°（头朝左、脚朝右）
 *
 * 载具被打破后切回普通站立姿态；动画本身不保存任何业务状态，
 * 回滚后由 Entity.syncViewFromModel() 重新同步。
 */
export class FlyingZombieAnim extends IZombieAnim {
  public balloon: Phaser.GameObjects.Sprite;

  private airborne = true;
  private hangPivotX = 0;
  private hangPivotY = 0;

  constructor(scene: Game, x: number, y: number, props: ZombieAnimProps) {
    super(scene, x, y, props);
    this.balloon = scene.add
      .sprite(x, y, "attach/balloon")
      .setOrigin(0.5, 1)
      .setScale(this.scaneFactor);
  }

  public setDepth(base: number) {
    super.setDepth(base);
    this.balloon.setDepth(DepthHelper.Mob.customAttachment(base, 14));
  }

  /** 载具在架 = 悬吊姿态；载具破碎 = 站立姿态。 */
  public setAirborne(airborne: boolean): void {
    this.balloon.setVisible(airborne);
    if (this.airborne === airborne) return;
    this.airborne = airborne;

    if (airborne) {
      this.applyHangPose();
      return;
    }
    for (const part of this.parts()) part.setAngle(0);
  }

  /** 悬吊时整套纸片零件的刚性旋转中心；固定挂件（帽子等）据此跟随。 */
  public getHangPivot(): { x: number; y: number } | null {
    if (!this.airborne) return null;
    return { x: this.hangPivotX, y: this.hangPivotY };
  }

  public updatePosition(x: number, y: number) {
    super.updatePosition(x, y);
    if (this.airborne) this.applyHangPose();
  }

  public startLegSwing() {
    if (!this.airborne) super.startLegSwing();
  }

  public stopLegSwing() {
    if (!this.airborne) super.stopLegSwing();
  }

  public startArmSwing() {
    if (!this.airborne) super.startArmSwing();
  }

  public stopArmSwing() {
    if (!this.airborne) super.stopArmSwing();
  }

  public destroy() {
    this.scene.tweens.killTweensOf([this.balloon]);
    this.balloon.destroy();
    super.destroy();
  }

  private parts(): Phaser.GameObjects.Sprite[] {
    return [this.body, this.head, this.armLeft, this.armRight, this.legLeft, this.legRight];
  }

  /**
   * 以躯体中心为轴把整套零件刚性旋转 -90°：每个零件的锚点绕轴旋转，
   * 同时自身角度加 -90°，合成结果等价于整体旋转。
   */
  private applyHangPose(): void {
    const bodyHeight = this.body.displayHeight;
    const lift = PositionManager.Instance.GRID_SIZEY * 0.45;
    const pivotX = this.body.x;
    const pivotY = this.body.y - bodyHeight * 0.5 - lift;

    this.hangPivotX = pivotX;
    this.hangPivotY = pivotY;

    for (const part of this.parts()) {
      const dx = part.x - pivotX;
      const dy = part.y - pivotY;
      part.setPosition(pivotX + dy, pivotY - dx);
      part.setAngle(-90);
    }

    // 旋转后躯体中心落在 pivot.x + lift，气球要对齐躯体中心而不是旋转轴。
    this.balloon.setPosition(pivotX + lift, pivotY - PositionManager.Instance.GRID_SIZEY * 0.05);
  }
}
