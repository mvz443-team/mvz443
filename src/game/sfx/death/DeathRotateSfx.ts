/*
 * Visual: Rotates the target game object toward 90 degrees as a quick death flip.
 * Example usage: Monster death rotation in src/game/models/entities/MonsterEntity.ts.
 */
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export interface DeathRotateSfxArgs extends BaseSfxArgs {
  targets: Phaser.GameObjects.GameObject[] | Phaser.GameObjects.GameObject;
  duration?: number;
}

export class DeathRotateSfx extends BaseSfx<DeathRotateSfxArgs> {
  play(): void {
    const targets = Array.isArray(this.args.targets) ? this.args.targets : [this.args.targets];
    const duration = this.args.duration ?? 400;

    if (targets.length === 0) {
      this.scene.time.delayedCall(duration, () => {
        this.args.onComplete?.();
      });
      return;
    }

    this.scene.tweens.add({
      targets,
      angle: 90,
      duration,
      ease: "Linear",
      onComplete: () => {
        this.args.onComplete?.();
      },
    });
  }
}
