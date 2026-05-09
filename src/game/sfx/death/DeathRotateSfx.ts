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
    this.scene.tweens.add({
      targets: this.args.targets,
      angle: 90,
      duration: this.args.duration ?? 400,
      ease: "Linear",
      onComplete: () => {
        this.args.onComplete?.();
      },
    });
  }
}
