/*
 * Visual: Alpha blinking tween for a brief flashing highlight.
 * Example usage: TNT arming blink in src/game/presets/plant/chapter1/tnt.ts.
 */
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export interface AlphaBlinkSfxArgs extends BaseSfxArgs {
  targets: any;
  from?: number;
  to?: number;
  duration?: number;
  repeat?: number;
  yoyo?: boolean;
  ease?: string;
}

export class AlphaBlinkSfx extends BaseSfx<AlphaBlinkSfxArgs> {
  play(): void {
    this.scene.tweens.add({
      targets: this.args.targets,
      alpha: { from: this.args.from ?? 1, to: this.args.to ?? 0.2 },
      duration: this.args.duration ?? 300,
      yoyo: this.args.yoyo ?? true,
      repeat: this.args.repeat ?? 3,
      ease: this.args.ease ?? 'Sine.easeInOut',
      onComplete: () => this.args.onComplete?.(),
    });
  }
}
