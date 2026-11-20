import { PositionManager } from "../managers/view/PositionManager";
import { Game } from "../scenes/Game";

/**
 * 气球TNT 分身的动画：单个漂浮 sprite。
 *
 * 分身是"飞在空中的炸弹"，没有纸片零件与走腿动画；
 * 这里只做位置跟随与整体上抬，所有状态（血量、爆炸）都在 Model。
 */
export class BalloonTntAnim {
  public body: Phaser.GameObjects.Sprite;

  private readonly lift: number;

  public constructor(scene: Game, x: number, y: number) {
    this.lift = PositionManager.Instance.GRID_SIZEY * 0.55;
    const size = PositionManager.Instance.getPlantDisplaySize();
    this.body = scene.add.sprite(x, y - this.lift, "plant/balloon_tnt", 2)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY);
  }

  public updatePosition(x: number, y: number): void {
    this.body.setPosition(x, y - this.lift);
  }

  public setDepth(depth: number): void {
    this.body.setDepth(depth);
  }

  public getHandAnchor(): null {
    return null;
  }

  public highlight(): void { }

  public twinkle(): void { }

  public startLegSwing(): void { }

  public stopLegSwing(): void { }

  public startArmSwing(): void { }

  public stopArmSwing(): void { }

  public destroy(): void {
    this.body.destroy();
  }
}
