import Phaser from "phaser";
import { EdxPreviewLoaderScene } from "./EdxPreviewLoaderScene";
import { EdxPreviewStage } from "./EdxPreviewStage";
import {
  EDX_PREVIEW_SELECTION_KEY,
  EDX_PREVIEW_VIEW_HEIGHT,
  EDX_PREVIEW_VIEW_WIDTH,
  type EdxPreviewSelection,
} from "./edxPreviewConfig";

/**
 * 创建一个只用于图鉴预览的小 Phaser.Game。
 *
 * 与战斗入口（`game/main.ts`）完全独立：不注册 Boot/Preloader/Game，
 * 不读 gameParams，不碰网络。画布逻辑尺寸固定，由 CSS/Scale.FIT 等比缩放进右栏。
 */
export function createEdxPreviewGame(
  parent: HTMLElement,
  selection: EdxPreviewSelection | null,
): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: EDX_PREVIEW_VIEW_WIDTH,
    height: EDX_PREVIEW_VIEW_HEIGHT,
    backgroundColor: "#0d1117",
    banner: false,
    audio: { noAudio: true },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    fps: {
      target: 60,
      forceSetTimeOut: false,
      smoothStep: true,
    },
    scene: [EdxPreviewLoaderScene, EdxPreviewStage],
  });
  // 在场景启动前写入，Loader → Stage 启动时直接读取，避免首帧空白。
  game.registry.set(EDX_PREVIEW_SELECTION_KEY, selection);
  return game;
}
