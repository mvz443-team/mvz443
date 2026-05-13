/*
 * Visual: Colored powder particles scatter in a small rectangle and fade out.
 * Example usage: Powder skills in src/game/presets/plant/chapter1/magic_powder.ts, ice_bomb.ts, and chapter2/glow_powder.ts.
 */
import { PositionManager } from "../../managers/view/PositionManager";
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export interface PowderScatterSfxArgs extends BaseSfxArgs {
  x: number;
  y: number;
  depth: number;
  color: number;
  count?: number;
  rangeWidth?: number;
  rangeHeight?: number;
  duration?: number;
}

export class PowderScatterSfx extends BaseSfx<PowderScatterSfxArgs> {
  play(): void {
    const posManager = PositionManager.Instance;
    const centerX = this.args.x;
    const centerY = this.args.y - posManager.GRID_SIZEY / 2;
    const rangeWidth = this.args.rangeWidth ?? posManager.GRID_SIZEX;
    const rangeHeight = this.args.rangeHeight ?? posManager.GRID_SIZEY;
    const rectWidth = posManager.GRID_SIZEX / 15;
    const rectHeight = posManager.GRID_SIZEX / 15;
    const rectCount = this.args.count ?? 15;
    const duration = this.args.duration ?? 1600;

    for (let i = 0; i < rectCount; i++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const startRadius = Phaser.Math.FloatBetween(0, Math.min(rangeWidth, rangeHeight) * 0.12);
      const endRadiusX = Phaser.Math.FloatBetween(rangeWidth * 0.18, rangeWidth * 0.55);
      const endRadiusY = Phaser.Math.FloatBetween(rangeHeight * 0.18, rangeHeight * 0.55);
      const startX = centerX + Math.cos(angle) * startRadius;
      const startY = centerY + Math.sin(angle) * startRadius;
      const endX = centerX + Math.cos(angle) * endRadiusX;
      const endY = centerY + Math.sin(angle) * endRadiusY;
      const particle = this.scene.add.rectangle(startX, startY, rectWidth, rectHeight, this.args.color, 0.92)
        .setAngle(Phaser.Math.Between(0, 360))
        .setDepth(this.args.depth);

      this.scene.tweens.add({
        targets: particle,
        x: endX,
        y: endY,
        alpha: 0,
        scale: 0.35,
        angle: particle.angle + Phaser.Math.Between(-160, 160),
        duration: Phaser.Math.Between(Math.floor(duration * 0.7), duration),
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }
}
