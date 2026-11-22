import type { Game } from "../../../scenes/Game";
import { IMonsterAnimController } from "./IMonsterAnimController";

export interface ColorBlockProps {
  width: number;
  height: number;
  fillColor: number;
  strokeColor?: number;
  strokeWidth?: number;
  legAmplitude?: number;
}

export class ColorBlockAnimController implements IMonsterAnimController {
  public isInAnim = false;

  private rect: Phaser.GameObjects.Rectangle;
  private legSwingTween: Phaser.Tweens.Tween | null = null;
  private highlightTimer: Phaser.Time.TimerEvent | null = null;
  private armSwingTween: Phaser.Tweens.Tween | null = null;
  private baseY = 0;

  constructor(scene: Game, x: number, y: number, props: ColorBlockProps) {
    this.baseY = y;
    this.rect = scene.add.rectangle(x, y, props.width, props.height, props.fillColor)
      .setOrigin(0.5, 1);

    if (props.strokeColor !== undefined) {
      this.rect.setStrokeStyle(props.strokeWidth ?? 2, props.strokeColor);
    }
  }

  public updatePosition(x: number, y: number): void {
    this.rect.x = x;
    this.rect.y = y;
    this.baseY = y;
  }

  public setDepth(depth: number): void {
    this.rect.setDepth(depth);
  }

  public highlight(): void {
    if (this.highlightTimer) return;
    const original = this.rect.fillColor;
    this.rect.setFillStyle(0xffffff);
    this.highlightTimer = this.rect.scene.time.delayedCall(80, () => {
      if (this.rect.scene) this.rect.setFillStyle(original);
      this.highlightTimer = null;
    });
  }

  public startLegSwing(): void {
    if (this.legSwingTween) return;
    this.legSwingTween = this.rect.scene.tweens.add({
      targets: this.rect,
      scaleY: 0.96,
      duration: 240,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  public stopLegSwing(): void {
    this.legSwingTween?.stop();
    this.legSwingTween = null;
    this.rect.setScale(1, 1);
  }

  public startArmSwing(): void {
    if (this.armSwingTween) return;
    this.armSwingTween = this.rect.scene.tweens.add({
      targets: this.rect,
      angle: { from: -6, to: 6 },
      duration: 220,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  public stopArmSwing(): void {
    this.armSwingTween?.stop();
    this.armSwingTween = null;
    this.rect.setAngle(0);
  }

  public setMotionSpeedScale(scale: number): void {
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    if (this.legSwingTween) this.legSwingTween.timeScale = s;
    if (this.armSwingTween) this.armSwingTween.timeScale = s;
  }

  public destroy(): void {
    this.legSwingTween?.stop();
    this.armSwingTween?.stop();
    this.highlightTimer?.remove(false);
    this.rect.destroy();
  }

  public getRect(): Phaser.GameObjects.Rectangle {
    return this.rect;
  }
}
