/*
 * Visual: Redstone energy drops in, waits briefly, then flies to the energy panel.
 * Example usage: furnace energy production and preset auto-energy callbacks.
 */
import { PositionManager } from "../../managers/view/PositionManager";
import DepthHelper from "../../utils/helper/DepthHelper";
import { getMobileSideBarLayout } from "../../ui/mobileSideBarLayout";
import { BaseSfx, BaseSfxArgs } from "../BaseSfx";

export type GainEnergySfxSize = "small" | "medium" | "large";

export interface GainEnergySfxArgs extends BaseSfxArgs {
  x: number;
  y: number;
  exactCenter?: boolean;
  size?: GainEnergySfxSize;
  delayMs?: number;
  targetX?: number;
  targetY?: number;
}

const SIZE_RATIO: Record<GainEnergySfxSize, number> = {
  small: 0.4,
  medium: 0.8,
  large: 1.4,
};

export class GainEnergySfx extends BaseSfx<GainEnergySfxArgs> {
  private container: Phaser.GameObjects.Container | null = null;
  private flyTimer: Phaser.Time.TimerEvent | null = null;
  private tweens: Phaser.Tweens.Tween[] = [];

  play(): void {
    const pos = PositionManager.Instance;
    const diameter = pos.GRID_SIZEX * SIZE_RATIO[this.args.size ?? "medium"];
    const startWorld = this.getStartWorldPoint();
    const target = this.getTargetScenePoint();
    const fallDistance = Math.max(22, pos.GRID_SIZEY * 0.5);

    this.container = this.scene.add.container(startWorld.x, startWorld.y - fallDistance)
      .setDepth(DepthHelper.Sfx.energyGainBattle())
      .setAlpha(0);
    this.buildEnergyVisual(this.container, diameter);

    this.tweens.push(this.scene.tweens.add({
      targets: this.container,
      y: startWorld.y,
      alpha: 1,
      duration: 360,
      ease: "Sine.easeIn",
    }));

    this.tweens.push(this.scene.tweens.add({
      targets: this.container,
      angle: 360,
      scale: { from: 0.92, to: 1.04 },
      duration: 820,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    }));

    this.flyTimer = this.scene.time.delayedCall(this.args.delayMs ?? 1000, () => {
      this.flyToTarget(target.x, target.y);
    });
  }

  override stop(): void {
    super.stop();
    this.flyTimer?.remove(false);
    this.flyTimer = null;
    for (const tween of this.tweens.splice(0)) {
      tween.stop();
      tween.remove();
    }
    this.destroyVisual(false);
  }

  private getStartWorldPoint(): { x: number; y: number } {
    if (this.args.exactCenter !== false) {
      return { x: this.args.x, y: this.args.y };
    }

    const spread = PositionManager.Instance.GRID_SIZEX * 0.5;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * spread;

    return {
      x: this.args.x + Math.cos(angle) * distance,
      y: this.args.y + Math.sin(angle) * distance,
    };
  }

  private buildEnergyVisual(container: Phaser.GameObjects.Container, diameter: number): void {
    const radius = diameter / 2;
    const glow = this.scene.add.graphics();

    for (let i = 5; i >= 1; i -= 1) {
      const ratio = i / 5;
      glow.fillStyle(0xff7b7b, 0.05 + (1 - ratio) * 0.11);
      glow.fillCircle(0, 0, radius * 0.9 * ratio);
    }

    glow.lineStyle(Math.max(2, radius * 0.08), 0xd82f2f, 0.92);
    glow.strokeCircle(0, 0, radius * 0.9);
    glow.lineStyle(Math.max(1, radius * 0.035), 0xffb1b1, 0.62);
    glow.strokeCircle(0, 0, radius * 0.72);
    container.add(glow);

    const icon = this.scene.add.image(0, 0, "redstone")
      .setDisplaySize(diameter * 0.52, diameter * 0.52)
      .setAlpha(0.98);
    container.add(icon);
  }

  private flyToTarget(targetX: number, targetY: number): void {
    if (!this.container || this.stopped) {
      return;
    }

    this.flyTimer = null;
    for (const tween of this.tweens.splice(0)) {
      tween.stop();
      tween.remove();
    }

    this.projectContainerToSceneLayer();

    const distance = Phaser.Math.Distance.Between(this.container.x, this.container.y, targetX, targetY);
    const cameraZoom = this.scene.cameras.main.zoom;
    const duration = Phaser.Math.Clamp(distance / 1.18, 260, 920);

    this.tweens.push(this.scene.tweens.add({
      targets: this.container,
      x: targetX,
      y: targetY,
      scale: 0.62 * cameraZoom,
      duration,
      ease: "Linear",
      onComplete: () => {
        if (!this.container || this.stopped) {
          return;
        }
        this.tweens.push(this.scene.tweens.add({
          targets: this.container,
          alpha: 0,
          scale: 0.24 * cameraZoom,
          duration: 90,
          ease: "Sine.easeOut",
          onComplete: () => this.destroyVisual(true),
        }));
      },
    }));
  }

  private getTargetScenePoint(): { x: number; y: number } {
    if (this.args.targetX !== undefined && this.args.targetY !== undefined) {
      return { x: this.args.targetX, y: this.args.targetY };
    }

    if ((this.scene.params?.deviceType ?? "pc") === "mobile") {
      const layout = getMobileSideBarLayout();
      const bounds = layout.bounds;
      const cardSection = layout.cardSection;

      return {
        x: bounds.x + layout.padding + layout.slotWidth / 2,
        y: bounds.y + cardSection.y + layout.padding + layout.slotHeight / 2,
      };
    }

    const top = PositionManager.Instance.getSceneChromeLayout("pc").topCardSlot;
    const energyWidth = Math.max(66, top.height * 0.72);

    return {
      x: top.x + energyWidth / 2,
      y: top.y + top.height * 0.42,
    };
  }

  private projectBattlePointToScene(x: number, y: number): { x: number; y: number } {
    const camera = this.scene.cameras.main;

    return {
      x: camera.x + (x - camera.scrollX) * camera.zoom,
      y: camera.y + (y - camera.scrollY) * camera.zoom,
    };
  }

  private projectContainerToSceneLayer(): void {
    if (!this.container) {
      return;
    }

    const camera = this.scene.cameras.main;
    const scenePoint = this.projectBattlePointToScene(this.container.x, this.container.y);
    const currentScale = this.container.scaleX;

    this.container
      .setPosition(scenePoint.x, scenePoint.y)
      .setScale(currentScale * camera.zoom)
      .setDepth(DepthHelper.Sfx.energyGain());
  }

  private destroyVisual(complete: boolean): void {
    this.container?.destroy(true);
    this.container = null;
    if (complete) {
      this.args.onComplete?.();
    }
  }
}
