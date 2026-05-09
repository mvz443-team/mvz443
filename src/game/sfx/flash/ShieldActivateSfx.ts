/*
 * Visual: Quick frame toggles to show a shield activation pulse on a sprite.
 * Example usage: Obsidian shield activation in src/game/presets/plant/chapter1/obsidian.ts.
 */
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export interface ShieldActivateSfxArgs extends BaseSfxArgs {
  sprite: Phaser.GameObjects.Sprite;
}

export class ShieldActivateSfx extends BaseSfx<ShieldActivateSfxArgs> {
  play(): void {
    const sprite = this.args.sprite;
    if (!sprite) return;

    sprite.setFrame(3);

    this.scene.time.delayedCall(150, () => {
      if (sprite && sprite.scene) sprite.setFrame(4);
    });

    this.scene.time.delayedCall(300, () => {
      if (sprite && sprite.scene) sprite.setFrame(3);
    });
  }
}
