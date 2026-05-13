/*
 * Visual: Plays the death smoke animation at a position and triggers a zombie death sound.
 * Example usage: Monster death smoke in src/game/models/entities/MonsterEntity.ts.
 */
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";
import SoundCmd from "../../utils/cmd/SoundCmd";

export interface DeathSmokeSfxArgs extends BaseSfxArgs {
  x: number;
  y: number;
  depth: number;
  displaySize?: number;
  playSound?: boolean;
}

export class DeathSmokeSfx extends BaseSfx<DeathSmokeSfxArgs> {
  play(): void {
    const scene = this.scene;
    if (this.args.playSound !== false) {
      SoundCmd.PlayZombieDeath();
    }

    if (!scene.anims.exists("death_smoke")) {
      scene.anims.create({
        key: "death_smoke",
        frames: scene.anims.generateFrameNumbers("anime/death_smoke", { start: 0, end: 7 }),
        frameRate: 16,
        repeat: 0,
      });
    }

    const size = this.args.displaySize ?? 100;
    const smoke = scene.add.sprite(this.args.x, this.args.y, "anime/death_smoke")
      .setDisplaySize(size, size)
      .setOrigin(0.5, 1)
      .setDepth(this.args.depth);
    smoke.play("death_smoke");
    smoke.once("animationcomplete", () => {
      smoke.destroy();
      this.args.onComplete?.();
    });
  }
}
