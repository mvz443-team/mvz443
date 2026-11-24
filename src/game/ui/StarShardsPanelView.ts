import DepthHelper from "../utils/helper/DepthHelper";
import CardpileManager from "../managers/combat/CardpileManager";
import PlantsManager from "../managers/combat/PlantsManager";
import ResourceManager from "../managers/combat/ResourceManager";
import type { Game } from "../scenes/Game";
import {
  drawSlotSelectionOutline,
  redrawSlotFrame,
  SLOT_BORDER,
  SLOT_FILL,
  SLOT_STROKE,
} from "./slotVisualStyle";

function stopInput(event?: Phaser.Types.Input.EventData) {
  event?.stopPropagation();
}

export class StarShardsPanelView {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly selectionGlow: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly countText: Phaser.GameObjects.Text;
  private readonly width: number;
  private readonly height: number;
  private readonly iconSize: number;
  private readonly renderMode: "icons" | "count";
  /** PC 图标模式：最多 5 个星形，0.5 块用最后一个半星表示。 */
  private readonly starIcons: Phaser.GameObjects.Image[] = [];
  /** 纹理原始尺寸，裁剪半星时要在 setCrop 前固定下来。 */
  private readonly starFrameWidth: number;
  private readonly unsubs: Array<() => void> = [];
  private starShards = 0;
  private selected = false;
  private flashTimer: Phaser.Time.TimerEvent | null = null;
  private selectionTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Game,
    x: number,
    y: number,
    width: number,
    height: number,
    renderMode: "icons" | "count" = "count",
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.renderMode = renderMode;
    this.container = scene.add.container(x, y).setDepth(DepthHelper.UI.chromeControl());
    this.bg = scene.add.graphics();
    this.selectionGlow = scene.add.graphics();
    this.icon = scene.add.image(0, 0, "starshards");
    this.countText = scene.add.text(0, 0, "x0", {
      fontFamily: "Arial, sans-serif",
      // PC 超过 5 时数字要清晰可读；移动端沿用原字号。
      fontSize: `${Math.max(
        10,
        Math.round(height * (renderMode === "icons" ? 0.6 : 0.36)),
      )}px`,
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(0, 0.5);

    this.starFrameWidth = this.icon.width;
    // 图标模式要把 5 颗星排进同一块面板，单颗尺寸按可用宽度缩小。
    this.iconSize = renderMode === "icons"
      ? Math.min(height * 0.68, Math.max(12, (width - 8) / 5))
      : Math.min(height * 0.68, width * 0.4);
    this.icon.setDisplaySize(this.iconSize, this.iconSize).setPosition(this.iconSize * 0.6 + 4, height / 2);
    this.countText.setPosition(this.iconSize + 10, height / 2);
    this.container.add([this.bg, this.icon, this.countText, this.selectionGlow]);

    if (renderMode === "icons") {
      this.icon.setVisible(false);
      this.countText.setVisible(false);
      for (let i = 0; i < 5; i++) {
        const star = scene.add.image(0, height / 2, "starshards")
          .setDisplaySize(this.iconSize, this.iconSize)
          .setVisible(false);
        this.starIcons.push(star);
        this.container.add(star);
      }
    }

    const hitZone = scene.add.zone(0, 0, width, height)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    hitZone.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => stopInput(event));
    hitZone.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      this.handleClick();
    });
    this.container.add(hitZone);

    this.unsubs.push(ResourceManager.Instance.Eventbus.on("onStarShardsUpdate", (value, playerId) => {
      if (playerId === ResourceManager.Instance.mineId) {
        this.starShards = value;
        this.draw();
      }
    }));
    this.unsubs.push(PlantsManager.Instance.EventBus.on("onStarshardsInsufficient", () => this.flash()));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenStarShards", () => {
      this.setSelected(true);
    }));
    for (const event of ["onChosenCard", "onChosenPickaxe", "onCancelChosen"] as const) {
      this.unsubs.push(CardpileManager.Instance.EventBus.on(event, () => {
        this.setSelected(false);
      }));
    }

    this.starShards = ResourceManager.Instance.getDisplayStarShards("mine");
    this.selected = CardpileManager.Instance.GetCurrentChoice().type === "starshards";
    this.syncSelectionTween();
    this.draw();
  }

  public destroy() {
    for (const unsubscribe of this.unsubs.splice(0)) {
      unsubscribe();
    }
    this.flashTimer?.remove(false);
    this.selectionTween?.remove();
    this.selectionTween = null;
    this.container.destroy(true);
  }

  private setSelected(selected: boolean) {
    if (this.selected === selected) {
      return;
    }
    this.selected = selected;
    this.syncSelectionTween();
    this.draw();
  }

  private handleClick() {
    if (this.starShards <= 0) {
      PlantsManager.Instance.EventBus.emit("onStarshardsInsufficient");
      return;
    }
    CardpileManager.Instance.ClickStarShards();
  }

  private flash() {
    this.flashTimer?.remove(false);
    this.draw(0xff3c3c);
    this.flashTimer = this.scene.time.delayedCall(450, () => {
      this.flashTimer = null;
      this.draw();
    });
  }

  private draw(borderOverride?: number) {
    redrawSlotFrame(
      this.bg,
      this.width,
      this.height,
      SLOT_FILL,
      borderOverride ?? SLOT_BORDER,
      borderOverride ? 3 : SLOT_STROKE,
    );
    this.selectionGlow.clear();
    if (this.selected) {
      drawSlotSelectionOutline(this.selectionGlow, this.width, this.height);
    }
    const textColor = borderOverride
      ? "#f44336"
      : this.starShards > 0 ? "#111111" : "#777777";

    // PC 图标模式：数量不超过 5 只画图标（含半块），超过 5 才用整星 + 数字。
    if (this.renderMode === "icons") {
      if (this.starShards <= 5) {
        this.drawStarIcons();
        return;
      }
      this.icon.setVisible(true);
      this.countText.setVisible(true);
      for (const star of this.starIcons) {
        star.setVisible(false);
      }
      this.icon.setCrop();
      this.icon.setDisplaySize(this.iconSize, this.iconSize);
      this.countText.setText(
        `x${Number.isInteger(this.starShards) ? this.starShards : this.starShards.toFixed(1)}`,
      );
      this.countText.setColor(textColor);
      // 星形 + 数字整体居中，避免数字紧贴左侧、右侧留一大片空白。
      const gap = 8;
      const groupWidth = this.iconSize + gap + this.countText.width;
      const startX = Math.max(4, (this.width - groupWidth) / 2);
      this.icon.setPosition(startX + this.iconSize / 2, this.height / 2);
      this.countText.setPosition(startX + this.iconSize + gap, this.height / 2);
      return;
    }

    // 移动端 count 模式：保持原有渲染（小数时图标裁半星），本次改动不影响移动端。
    this.icon.setVisible(true);
    this.countText.setVisible(true);
    if (this.starShards > 0 && !Number.isInteger(this.starShards)) {
      this.icon.setCrop(0, 0, this.starFrameWidth / 2, this.icon.height);
      this.icon.setDisplaySize(this.iconSize / 2, this.iconSize);
      this.countText.setText(`x${this.starShards.toFixed(1)}`);
    } else {
      this.icon.setCrop();
      this.icon.setDisplaySize(this.iconSize, this.iconSize);
      this.countText.setText(`x${this.starShards}`);
    }
    this.countText.setColor(textColor);
  }

  /** 图标模式：整星 + 可选半星，最多铺满 5 个星位。 */
  private drawStarIcons() {
    this.icon.setVisible(false);
    this.countText.setVisible(false);
    const value = Math.max(0, this.starShards);
    const wholeCount = Math.min(5, Math.floor(value));
    const hasHalf = value - wholeCount >= 0.5 && wholeCount < 5;
    // 只有一颗（或半颗）时放大显示，避免半星挤成一条细缝。
    const slots = Math.max(1, Math.ceil(value));
    const slotSize = Math.min(this.height * 0.68, Math.max(12, (this.width - 8) / slots));
    const gap = Math.max(2, slotSize * 0.08);
    const groupWidth = slots * slotSize + (slots - 1) * gap;
    let cursor = Math.max(4, (this.width - groupWidth) / 2);

    this.starIcons.forEach((star, index) => {
      if (index < wholeCount) {
        star.setVisible(true);
        star.setCrop();
        star.setDisplaySize(slotSize, slotSize);
        star.setPosition(cursor + slotSize / 2, this.height / 2);
        cursor += slotSize + gap;
        return;
      }
      if (index === wholeCount && hasHalf) {
        star.setVisible(true);
        // 只裁掉右半边，但仍按整颗星的显示尺寸绘制：裁切本身已经减半，
        // 再按半宽显示会变成 1/4 大小，看起来不像半块。
        star.setCrop(0, 0, this.starFrameWidth / 2, star.height);
        star.setDisplaySize(slotSize, slotSize);
        star.setPosition(cursor + slotSize / 2, this.height / 2);
        cursor += slotSize + gap;
        return;
      }
      star.setVisible(false);
    });
  }

  private syncSelectionTween() {
    this.selectionTween?.remove();
    this.selectionTween = null;
    if (!this.selected) {
      this.selectionGlow.setAlpha(1);
      return;
    }
    this.selectionGlow.setAlpha(0.35);
    this.selectionTween = this.scene.tweens.add({
      targets: this.selectionGlow,
      alpha: { from: 0.35, to: 1 },
      duration: 650,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1,
    });
  }
}
