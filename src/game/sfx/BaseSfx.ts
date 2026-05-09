/*
 * Visual: Base class for visual-only SFX. This file does not render anything by itself.
 * Example usage: All SFX classes (e.g., ArcSfx, ExplosionSfx) extend this and are spawned via SfxCmd.Create in src/game/utils/cmd/SfxCmd.ts.
 */
import type { Game } from "../scenes/Game";

export interface BaseSfxArgs {
  scene: Game;
  onComplete?: () => void;
}

export abstract class BaseSfx<TArgs extends BaseSfxArgs = BaseSfxArgs> {
  protected scene: Game;
  protected args: TArgs;
  protected stopped = false;

  constructor(args: TArgs) {
    this.scene = args.scene;
    this.args = args;
  }

  abstract play(): void;

  stop(): void {
    this.stopped = true;
  }
}
