import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { Scene } from "phaser";
import {
  queueAllMonsterAssets,
  queueAllPlantAssets,
  queueAllProjectileAssets,
  queueAllSpriteAssets,
} from "./battleAssetManifest";
import { EDX_PREVIEW_STAGE_KEY } from "./EdxPreviewStage";
import { EDX_PREVIEW_VIEW_HEIGHT, EDX_PREVIEW_VIEW_WIDTH } from "./edxPreviewConfig";

export const EDX_PREVIEW_LOADER_KEY = "EdxPreviewLoader";

/**
 * 图鉴预览的素材装载场景。
 *
 * 素材清单与真实战斗共用 `battleAssetManifest`：预览跑的是真实 Entity，
 * 只要少一张贴图，某些 preset 就会静默空白。素材在浏览器缓存里，
 * 第二次打开图鉴基本是瞬时完成。
 */
export class EdxPreviewLoaderScene extends Scene {
  private label: Phaser.GameObjects.Text | null = null;

  constructor() {
    super(EDX_PREVIEW_LOADER_KEY);
  }

  public preload(): void {
    this.label = this.add.text(
      EDX_PREVIEW_VIEW_WIDTH / 2,
      EDX_PREVIEW_VIEW_HEIGHT / 2,
      "预览加载中…",
      { fontSize: "16px", color: "#8fb8c8" },
    ).setOrigin(0.5);

    const load = this.load;
    load.setPath("assets");
    queueAllPlantAssets(load);
    queueAllMonsterAssets(load);
    queueAllProjectileAssets(load);
    queueAllSpriteAssets(load);
  }

  public create(): void {
    this.label?.destroy();
    this.label = null;
    // Rapier 是全局 WASM 单例，提前初始化，让战斗场景可以同步建世界。
    void RAPIER.init().then(() => {
      this.scene.start(EDX_PREVIEW_STAGE_KEY);
    });
  }
}
