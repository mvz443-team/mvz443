/*
 * Visual: Centipede skill effects (ring, dust, slash) that fade and scale based on the skill kind.
 * Example usage: Centipede skill visuals in src/game/presets/monster/centipede/centipede.ts.
 */
import DepthHelper from "../../utils/helper/DepthHelper";
import { PositionManager } from "../../managers/view/PositionManager";
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export type CentipedeSkillSfxKind = "mine" | "charge" | "summon" | "blast";

export interface CentipedeSkillSfxArgs extends BaseSfxArgs {
  x: number;
  y: number;
  kind: CentipedeSkillSfxKind;
  width?: number;
  height?: number;
}

const TEXTURE_BY_KIND: Record<CentipedeSkillSfxKind, string> = {
  mine: "sfxCentipedeSummonRing",
  charge: "sfxCentipedeChargeDust",
  summon: "sfxCentipedeSummonRing",
  blast: "sfxCentipedeSlash",
};

export class CentipedeSkillSfx extends BaseSfx<CentipedeSkillSfxArgs> {
  play(): void {
    const { x, y, kind, width, height } = this.args;
    const texture = TEXTURE_BY_KIND[kind];
    const depth = DepthHelper.Projectile.centipedeSkill();
    const scaleFactor = PositionManager.Instance.scaleFactor;

    if (kind === "charge") {
      this.playChargeDust(texture, x, y, depth, scaleFactor);
      return;
    }

    const image = this.scene.add.image(x, y, texture)
      .setDepth(depth)
      .setAlpha(0.85);

    if (width || height) {
      image.setDisplaySize(width ?? image.width * scaleFactor, height ?? image.height * scaleFactor);
    } else {
      image.setScale(scaleFactor * (kind === "blast" ? 1.7 : 1.25));
    }

    this.scene.tweens.add({
      targets: image,
      alpha: 0,
      scaleX: image.scaleX * 1.45,
      scaleY: image.scaleY * 1.45,
      angle: kind === "blast" ? -20 : 35,
      duration: kind === "blast" ? 360 : 520,
      ease: "Sine.easeOut",
      onComplete: () => {
        image.destroy();
        this.args.onComplete?.();
      },
    });
  }

  private playChargeDust(texture: string, x: number, y: number, depth: number, scaleFactor: number): void {
    const key = "sfxCentipedeChargeDustAnim";
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers(texture, { start: 0, end: 3 }),
        frameRate: 14,
        repeat: 0,
      });
    }

    const sprite = this.scene.add.sprite(x, y, texture)
      .setDepth(depth)
      .setScale(scaleFactor * 1.8)
      .setAlpha(0.85);
    sprite.play(key);
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      sprite.destroy();
      this.args.onComplete?.();
    });
  }
}
