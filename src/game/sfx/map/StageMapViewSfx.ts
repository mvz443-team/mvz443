/*
 * Visual: stage-map events — ground collapse dust and the "lights out" flicker.
 * This file only touches Phaser view objects; all authoritative state lives in
 * the level script + PresetEventManager and is registered in RuntimeStateBridge.
 *
 * 通用实现：格子与闪烁次数由调用方（关卡脚本经 ctx）传入，不绑定具体关卡。
 */
import type { Game } from "../../scenes/Game";
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
import DepthHelper from "../../utils/helper/DepthHelper";
import { LOGICAL_BATTLE_HEIGHT, LOGICAL_BATTLE_WIDTH } from "../../../constants/gameLayout";
import { PositionManager } from "../../managers/view/PositionManager";
import type { GridCell } from "../../stages/types";

export interface CollapseSfxArgs extends BaseSfxArgs {
  cells: readonly GridCell[];
}

/** 崩塌瞬间的尘土/落块表现：每格一个短暂下坠的深色方块，纯视觉。 */
export class CollapseSfx extends BaseSfx<CollapseSfxArgs> {
  play(): void {
    const scene = this.scene;
    const size = PositionManager.Instance.getGridSize();
    const offset = PositionManager.Instance.getGridOffset();
    const scale = PositionManager.Instance.scaleFactor;
    for (const cell of this.args.cells) {
      try {
        const rect = scene.add.rectangle(
          offset.x + (cell.col + 0.5) * size.width,
          offset.y + (cell.row + 0.5) * size.height,
          size.width * 0.92,
          size.height * 0.92,
          0x6b5a3a,
          0.85,
        ).setDepth(DepthHelper.Scene.presetImage());
        scene.tweens.add({
          targets: rect,
          y: rect.y + size.height * 0.35,
          alpha: 0,
          scaleX: 0.6 * scale,
          scaleY: 0.6 * scale,
          duration: 420,
          ease: "Quad.easeIn",
          onComplete: () => rect.destroy(),
        });
      } catch (error) {
        console.warn("[CollapseSfx] skipped a tile.", error);
      }
    }
    try {
      scene.cameras.main.shake(260, 0.004);
    } catch {
      /* 视图不可用时忽略 */
    }
  }
}

export interface LightRemovalSfxArgs extends BaseSfxArgs {
  flickerCount: number;
}

/**
 * 地图光照取消：一张全屏暗色遮罩闪烁 N 次后消失。自包含（自建自毁）。
 * 本 SFX 不写任何逻辑状态；"取消光照"由关卡脚本的 dayOrNight 快照完成。
 */
export class LightRemovalSfx extends BaseSfx<LightRemovalSfxArgs> {
  play(): void {
    const scene = this.scene;
    const count = Math.max(1, Math.floor(this.args.flickerCount));
    let overlay: Phaser.GameObjects.Rectangle | null = null;
    try {
      overlay = scene.add.rectangle(
        LOGICAL_BATTLE_WIDTH / 2,
        LOGICAL_BATTLE_HEIGHT / 2,
        LOGICAL_BATTLE_WIDTH,
        LOGICAL_BATTLE_HEIGHT,
        0x000000,
        0.6,
      ).setDepth(DepthHelper.Mob.sceneFlash()).setAlpha(0);
    } catch (error) {
      console.warn("[LightRemovalSfx] overlay unavailable.", error);
      return;
    }
    scene.tweens.add({
      targets: overlay,
      alpha: 0.6,
      duration: 130,
      yoyo: true,
      repeat: count - 1,
      ease: "Sine.easeInOut",
      onComplete: () => overlay?.destroy(),
    });
  }
}

/** 崩塌表现入口。 */
export function playCollapseSfx(scene: Game, cells: readonly GridCell[]): void {
  SfxCmd.Create(CollapseSfx, { scene, cells });
}

/** 光照闪烁表现入口。 */
export function playLightRemovalSfx(scene: Game, flickerCount: number): void {
  SfxCmd.Create(LightRemovalSfx, { scene, flickerCount });
}
