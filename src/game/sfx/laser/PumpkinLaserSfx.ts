/*
 * Visual: Jack-o-lantern laser, with a white-hot core, golden body, and wavy flame edges.
 */
import { PositionManager } from "../../managers/view/PositionManager";
import DepthHelper from "../../utils/helper/DepthHelper";
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export interface PumpkinLaserSfxArgs extends BaseSfxArgs {
  x: number;
  y: number;
  row: number;
  distanceGrid: number;
  duration: number;
}

export class PumpkinLaserSfx extends BaseSfx<PumpkinLaserSfxArgs> {
  play(): void {
    const posManager = PositionManager.Instance;
    const width = this.args.distanceGrid * posManager.GRID_SIZEX;
    const height = posManager.GRID_SIZEY * 0.46;
    const coreHeight = Math.max(3, height * 0.22);
    const x = this.args.x;
    const y = this.args.y;
    const depth = DepthHelper.Projectile.laser(this.args.row);

    const body = this.scene.add.graphics().setDepth(depth);
    body.fillStyle(0xff8c1a, 0.18);
    body.fillRect(x, y - height * 0.58, width, height * 1.16);
    body.fillStyle(0xffb321, 0.36);
    body.fillRect(x, y - height * 0.38, width, height * 0.76);
    body.fillStyle(0xffdc54, 0.48);
    body.fillRect(x, y - height * 0.25, width, height * 0.5);
    body.fillStyle(0xffffff, 0.86);
    body.fillRect(x, y - coreHeight / 2, width, coreHeight);

    const waves = this.scene.add.graphics().setDepth(depth + 1);
    this.drawWave(waves, x, y - height * 0.5, width, 0xfff08a, 0.78, 3.5, 0);
    this.drawWave(waves, x, y + height * 0.5, width, 0xfff08a, 0.78, 3.5, Math.PI);
    this.drawWave(waves, x, y - height * 0.34, width, 0xff8d12, 0.38, 7, Math.PI * 0.5);
    this.drawWave(waves, x, y + height * 0.34, width, 0xff8d12, 0.38, 7, Math.PI * 1.5);

    const sparks = this.scene.add.graphics().setDepth(depth + 2);
    for (let i = 0; i < 12; i++) {
      const sparkX = x + Phaser.Math.FloatBetween(0, width);
      const sparkY = y + Phaser.Math.FloatBetween(-height * 0.42, height * 0.42);
      sparks.fillStyle(i % 2 === 0 ? 0xffffff : 0xffd34d, Phaser.Math.FloatBetween(0.32, 0.7));
      sparks.fillCircle(sparkX, sparkY, Phaser.Math.FloatBetween(1.4, 3.2) * posManager.scaleFactor);
    }

    this.scene.tweens.add({
      targets: [body, waves, sparks],
      alpha: 0,
      duration: this.args.duration,
      ease: "Sine.easeOut",
      onComplete: () => {
        body.destroy();
        waves.destroy();
        sparks.destroy();
        this.args.onComplete?.();
      },
    });
  }

  private drawWave(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    color: number,
    alpha: number,
    amplitude: number,
    phase: number,
  ): void {
    const step = Math.max(8, PositionManager.Instance.GRID_SIZEX / 8);
    graphics.lineStyle(3, color, alpha);
    graphics.beginPath();
    graphics.moveTo(x, y + Math.sin(phase) * amplitude);
    for (let dx = step; dx <= width; dx += step) {
      const waveY = y + Math.sin(dx * 0.075 + phase) * amplitude;
      graphics.lineTo(x + dx, waveY);
    }
    graphics.strokePath();
  }
}
