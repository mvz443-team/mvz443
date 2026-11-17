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
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.container = scene.add.container(x, y).setDepth(DepthHelper.UI.chromeControl());
    this.bg = scene.add.graphics();
    this.selectionGlow = scene.add.graphics();
    this.icon = scene.add.image(0, 0, "starshards");
    this.countText = scene.add.text(0, 0, "x0", {
      fontFamily: "Arial, sans-serif",
      fontSize: `${Math.max(10, Math.round(height * 0.36))}px`,
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(0, 0.5);

    const iconSize = Math.min(height * 0.68, width * 0.4);
    this.icon.setDisplaySize(iconSize, iconSize).setPosition(iconSize * 0.6 + 4, height / 2);
    this.countText.setPosition(iconSize + 10, height / 2);
    this.container.add([this.bg, this.icon, this.countText, this.selectionGlow]);

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
    this.countText.setText(`x${this.starShards}`);
    this.countText.setColor(
      borderOverride
        ? "#f44336"
        : this.starShards > 0 ? "#111111" : "#777777",
    );
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
