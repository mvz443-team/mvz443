/*
 * Visual: a star-shard drop appears at its source and flies to the star-shard panel (bottom-left).
 * Pure presentation only: no ResourceCmd, no logic timer, no snapshot state.
 */
import { PositionManager } from "../../managers/view/PositionManager";
import DepthHelper from "../../utils/helper/DepthHelper";
import { getMobileSideBarLayout } from "../../ui/mobileSideBarLayout";
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export interface GainStarShardSfxArgs extends BaseSfxArgs {
  x: number;
  y: number;
  amount?: number;
  /** 半块星碎：联机收益减半后出现 0.5 块时只显示左半边星形。 */
  half?: boolean;
  /** 动画总时长（ms）：按飞行距离反推停留时间，使远近起点动画都在此时长内结束。 */
  totalDurationMs?: number;
  targetX?: number;
  targetY?: number;
}

/** 外圈银色到内圈白色的渐变光环。 */
const RING_COLORS = [0x9ba1a8, 0xb4bac1, 0xcfd4d9, 0xe5e8eb, 0xf4f6f7, 0xffffff] as const;

export class GainStarShardSfx extends BaseSfx<GainStarShardSfxArgs> {
  private container: Phaser.GameObjects.Container | null = null;
  private tweens: Phaser.Tweens.Tween[] = [];

  play(): void {
    if (!this.scene?.add || !this.scene?.tweens || !this.scene?.cameras?.main) return;

    const pos = PositionManager.Instance;
    const diameter = Math.max(18, pos.GRID_SIZEX * 0.42);
    const target = this.getTargetScenePoint();

    this.container = this.scene.add.container(this.args.x, this.args.y)
      .setDepth(DepthHelper.Sfx.energyGain());
    this.buildVisual(this.container, diameter);
    this.projectContainerToSceneLayer();

    const zoom = this.scene.cameras.main.zoom;
    const start = { x: this.container.x, y: this.container.y };
    const distance = Phaser.Math.Distance.Between(start.x, start.y, target.x, target.y);
    const duration = Phaser.Math.Clamp(distance / 1.05, 320, 980);

    // 两段式：先原地停留，再飞向 HUD。停留时长按飞行距离反推，使动画总时长
    // 接近 totalDurationMs（纯视觉，不影响逻辑到账延迟）。
    const stayMs = this.args.totalDurationMs !== undefined
      ? Math.max(0, this.args.totalDurationMs - duration - 110)
      : 0;
    if (stayMs > 0) {
      this.tweens.push(this.scene.tweens.add({
        targets: this.container,
        scale: { from: 1, to: 1.08 },
        duration: stayMs,
        ease: "Sine.easeInOut",
        yoyo: true,
        onComplete: () => this.flyToTarget(target.x, target.y, zoom, duration),
      }));
    } else {
      this.flyToTarget(target.x, target.y, zoom, duration);
    }
  }

  private flyToTarget(targetX: number, targetY: number, zoom: number, duration: number): void {
    if (!this.container || this.stopped) return;
    this.tweens.push(this.scene.tweens.add({
      targets: this.container,
      x: targetX,
      y: targetY,
      scale: 0.6 * zoom,
      angle: 200,
      duration,
      ease: "Sine.easeIn",
      onComplete: () => {
        if (!this.container || this.stopped) return;
        this.tweens.push(this.scene.tweens.add({
          targets: this.container,
          alpha: 0,
          scale: 0.24 * zoom,
          duration: 110,
          ease: "Sine.easeOut",
          onComplete: () => this.destroyVisual(true),
        }));
      },
    }));
  }

  override stop(): void {
    super.stop();
    for (const tween of this.tweens.splice(0)) {
      tween.stop();
      tween.remove();
    }
    this.destroyVisual(false);
  }

  private buildVisual(container: Phaser.GameObjects.Container, diameter: number): void {
    const radius = diameter / 2;
    const ring = this.scene.add.graphics();
    ring.fillStyle(0xffffff, 0.08);
    ring.fillCircle(0, 0, radius * 0.78);
    RING_COLORS.forEach((color, index) => {
      const ratio = index / (RING_COLORS.length - 1);
      ring.lineStyle(
        Math.max(1.5, diameter * (0.1 - ratio * 0.055)),
        color,
        0.32 + ratio * 0.6,
      );
      ring.strokeCircle(0, 0, radius * (1 - ratio * 0.16));
    });
    container.add(ring);

    const star = this.scene.add.image(0, 0, "starshards")
      .setAlpha(0.98);
    if (this.args.half) {
      // 32x32 单帧纹理：裁掉右半边，再按半宽显示，得到一块“半星”。
      star.setCrop(0, 0, star.width / 2, star.height);
      star.setDisplaySize(diameter * 0.26, diameter * 0.52);
    } else {
      star.setDisplaySize(diameter * 0.52, diameter * 0.52);
    }
    container.add(star);
  }

  private projectContainerToSceneLayer(): void {
    if (!this.container) return;
    const camera = this.scene.cameras.main;
    this.container
      .setPosition(
        camera.x + (this.container.x - camera.scrollX) * camera.zoom,
        camera.y + (this.container.y - camera.scrollY) * camera.zoom,
      )
      .setScale(camera.zoom)
      .setDepth(DepthHelper.Sfx.energyGain());
  }

  private getTargetScenePoint(): { x: number; y: number } {
    if (this.args.targetX !== undefined && this.args.targetY !== undefined) {
      return { x: this.args.targetX, y: this.args.targetY };
    }

    if ((this.scene.params?.deviceType ?? "pc") === "mobile") {
      const layout = getMobileSideBarLayout();
      const action = layout.actionSection;
      const panelWidth = action.width * 0.58;
      return {
        x: layout.bounds.x + action.x + panelWidth * 0.22,
        y: layout.bounds.y + action.y + action.height * 0.5,
      };
    }

    const toolbar = PositionManager.Instance.getSceneChromeLayout("pc").bottomToolbar;
    const panelX = toolbar.x + toolbar.width * 0.13;
    const panelWidth = Math.max(toolbar.width * 0.1, toolbar.height * 2.4);
    return {
      x: panelX + panelWidth * 0.2,
      y: toolbar.y + toolbar.height * 0.5,
    };
  }

  private destroyVisual(complete: boolean): void {
    this.container?.destroy(true);
    this.container = null;
    if (complete) {
      this.args.onComplete?.();
    }
  }
}
