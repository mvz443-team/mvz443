/*
 * Visual: Wide pumpkin laser burst, rendered as rounded golden beams with white cores.
 */
import DepthHelper from "../../utils/helper/DepthHelper";
import { PositionManager } from "../../managers/view/PositionManager";
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export interface PumpkinWanLaserSfxArgs extends BaseSfxArgs {
  x: number;
  y: number;
  row: number;
  lengthGrid: number;
  duration: number;
}

export class PumpkinWanLaserSfx extends BaseSfx<PumpkinWanLaserSfxArgs> {
  play(): void {
    const posManager = PositionManager.Instance;
    const radius = this.args.lengthGrid * posManager.GRID_SIZEX;
    const beamHeight = Math.max(8, posManager.GRID_SIZEY * 0.12);
    const centerX = this.args.x;
    const centerY = this.args.y;
    const depth = DepthHelper.Projectile.laser(this.args.row);
    const beams: Phaser.GameObjects.GameObject[] = [];
    const rayCount = 18;

    for (let i = 0; i < rayCount; i++) {
      const angle = (Math.PI * 2 * i) / rayCount;
      const midX = centerX + Math.cos(angle) * radius / 2;
      const midY = centerY + Math.sin(angle) * radius / 2;
      const group = this.scene.add.container(midX, midY).setRotation(angle).setDepth(depth);
      const glow = this.scene.add.rectangle(0, 0, radius, beamHeight * 2.6, 0xff8a18, 0.15)
        .setOrigin(0.5)
        .setStrokeStyle(2, 0xffb321, 0.2);
      const outer = this.scene.add.rectangle(0, 0, radius, beamHeight * 1.38, 0xffbc28, 0.46)
        .setOrigin(0.5)
        .setStrokeStyle(2, 0xfff08a, 0.55);
      const core = this.scene.add.rectangle(0, 0, radius * 0.98, beamHeight * 0.34, 0xffffff, 0.78)
        .setOrigin(0.5);

      glow.setRounded(beamHeight * 1.3);
      outer.setRounded(beamHeight * 0.7);
      core.setRounded(beamHeight * 0.22);
      group.add([glow, outer, core]);
      beams.push(group);

      this.scene.tweens.add({
        targets: group,
        alpha: 0,
        scaleX: 1.08,
        duration: this.args.duration,
        ease: "Sine.easeOut",
        onComplete: () => group.destroy(true),
      });
    }

    const pulse = this.scene.add.circle(centerX, centerY, posManager.GRID_SIZEX * 0.18, 0xffb321, 0.3)
      .setStrokeStyle(2, 0xffffff, 0.5)
      .setDepth(depth + 1);
    beams.push(pulse);
    this.scene.tweens.add({
      targets: pulse,
      alpha: 0,
      scale: 2.8,
      duration: this.args.duration,
      ease: "Sine.easeOut",
      onComplete: () => {
        pulse.destroy();
        this.args.onComplete?.();
      },
    });
  }
}
