import type { Game } from "../scenes/Game";
import DepthHelper from "../utils/helper/DepthHelper";
import { PositionManager } from "../managers/view/PositionManager";
import CardpileManager from "../managers/combat/CardpileManager";
import ResourceManager from "../managers/combat/ResourceManager";
import PlantsManager from "../managers/combat/PlantsManager";
import { PlantLibrary } from "../managers/library/PlantLibrary";
import type { PlantModel } from "../models/PlantModel";
import { translate } from "../../i18n";
import { cardKey } from "../../i18n/keys";
import {
  getPcCardSlotChromeLayout,
  type CardSlotChromeLayout,
  type SlotFrameKind,
  type SlotPosition,
} from "../../constants/cardSlotLayout";
import {
  drawSlotSelectionOutline,
  redrawSlotFrame,
  SLOT_BORDER,
  SLOT_FILL,
  SLOT_STROKE,
  slotRadius,
} from "./slotVisualStyle";

export const UI_CHROME_DEPTH = DepthHelper.UI.chrome();

type CardViewOptions = {
  scene: Game;
  slot: SlotPosition;
  plantModel: PlantModel;
  level: number;
  disableWhenExpensive?: boolean;
};

type ArtLayout = {
  x: number;
  y: number;
  maxWidth: number;
  maxHeight: number;
};

type CostLayout = {
  x: number;
  y: number;
  maxWidth: number;
  fontSize: number;
  strokeWidth: number;
};

const PANEL_BG = 0x303030;
const PANEL_BORDER = 0x111111;

function stopInput(event?: Phaser.Types.Input.EventData) {
  event?.stopPropagation();
}

function setTextSizeToFit(
  text: Phaser.GameObjects.Text,
  maxWidth: number,
  preferred: number,
  minSize: number,
) {
  let size = preferred;
  text.setFontSize(size);
  while (text.width > maxWidth && size > minSize) {
    size -= 1;
    text.setFontSize(size);
  }
}

function getCardTextureKey(scene: Game, plantModel: PlantModel): string {
  const cardKey = `card/${plantModel.texturePath}`;
  return scene.textures.exists(cardKey) ? cardKey : plantModel.texturePath;
}

function getArtLayout(frame: SlotFrameKind, width: number, height: number): ArtLayout {
  if (frame === "mobile-square") {
    return {
      x: width * 0.28,
      y: height * 0.5,
      maxWidth: width * 0.48,
      maxHeight: height * 0.8,
    };
  }
  return {
    x: width * 0.5,
    y: height * 0.44,
    maxWidth: width * 0.78,
    maxHeight: height * 0.62,
  };
}

function getCostLayout(frame: SlotFrameKind, width: number, height: number): CostLayout {
  if (frame === "mobile-square") {
    return {
      x: width * 0.79,
      y: height * 0.56,
      maxWidth: width * 0.46,
      fontSize: Math.max(12, Math.round(height * 0.38)),
      strokeWidth: 3,
    };
  }
  return {
    x: width * 0.5,
    y: height * 0.84,
    maxWidth: width * 0.56,
    fontSize: Math.max(10, Math.round(height * 0.18)),
    strokeWidth: 3,
  };
}

export class PlantCardView {
  public readonly pid: number;
  public readonly level: number;
  public readonly cost: number;

  private readonly scene: Game;
  private readonly slot: SlotPosition;
  private readonly width: number;
  private readonly height: number;
  private readonly frame: SlotFrameKind;
  private readonly disableWhenExpensive: boolean;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly selectionGlow: Phaser.GameObjects.Graphics;
  private readonly tooltip: Phaser.GameObjects.Container | null;
  private readonly hitZone: Phaser.GameObjects.Zone;
  private costText: Phaser.GameObjects.Text | null = null;
  private energy = 0;
  private reloaded = false;
  private leftPercent = 1;
  private selected = false;
  private hovered = false;
  private selectionTween: Phaser.Tweens.Tween | null = null;

  constructor(options: CardViewOptions) {
    this.scene = options.scene;
    this.slot = options.slot;
    this.width = options.slot.width;
    this.height = options.slot.height;
    this.frame = options.slot.frame;
    this.disableWhenExpensive = options.disableWhenExpensive ?? false;
    this.pid = options.plantModel.pid;
    this.level = options.level;
    this.cost = options.plantModel.cost.getValueAt(options.level);
    this.container = this.scene.add.container(options.slot.x, options.slot.y)
      .setDepth(DepthHelper.UI.chromeControl());
    this.bg = this.scene.add.graphics();
    this.overlay = this.scene.add.graphics();
    this.selectionGlow = this.scene.add.graphics();
    this.container.add(this.bg);
    this.addPlantImage(options.plantModel);
    this.container.add(this.overlay);
    this.addCostText();
    this.container.add(this.selectionGlow);
    this.tooltip = this.addTooltip(options.plantModel);
    this.hitZone = this.scene.add.zone(this.width / 2, this.height / 2, this.width, this.height)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.container.add(this.hitZone);
    this.hitZone.on("pointerover", () => {
      if (this.frame === "mobile-square") {
        return;
      }
      this.hovered = true;
      this.applyScale();
      this.tooltip?.setVisible(true);
    });
    this.hitZone.on("pointerout", () => {
      if (this.frame === "mobile-square") {
        return;
      }
      this.hovered = false;
      this.applyScale();
      this.tooltip?.setVisible(false);
    });
    this.hitZone.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      if (this.canPress()) {
        this.container.setScale(0.97);
      }
    });
    this.hitZone.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      this.applyScale();
      this.handleClick();
    });
    this.draw();
  }

  public get index(): number {
    return this.slot.index;
  }

  public setEnergy(energy: number) {
    this.energy = energy;
    this.draw();
  }

  public setCooldown(hasReloaded: boolean, leftPercent: number) {
    this.reloaded = hasReloaded;
    this.leftPercent = Math.max(0, Math.min(1, leftPercent));
    this.draw();
  }

  public setSelected(selected: boolean) {
    if (this.selected === selected) {
      return;
    }
    this.selected = selected;
    this.syncSelectionTween();
    this.draw();
  }

  public destroy() {
    this.selectionTween?.remove();
    this.selectionTween = null;
    this.container.destroy(true);
  }

  private addPlantImage(plantModel: PlantModel) {
    const layout = getArtLayout(this.frame, this.width, this.height);
    const textureKey = getCardTextureKey(this.scene, plantModel);
    const image = this.scene.add.image(layout.x, layout.y, textureKey);
    const scale = Math.min(layout.maxWidth / image.width, layout.maxHeight / image.height);
    image.setScale(Number.isFinite(scale) ? scale : 1);
    this.container.add(image);
  }

  private addCostText() {
    const layout = getCostLayout(this.frame, this.width, this.height);
    const text = this.scene.add.text(layout.x, layout.y, String(this.cost), {
      fontFamily: "Arial, sans-serif",
      fontSize: `${layout.fontSize}px`,
      color: "#ffffff",
      fontStyle: "bold",
      stroke: "#111111",
      strokeThickness: layout.strokeWidth,
    }).setOrigin(0.5);
    setTextSizeToFit(text, layout.maxWidth, layout.fontSize, 8);
    this.costText = text;
    this.container.add(text);
  }

  private addTooltip(plantModel: PlantModel): Phaser.GameObjects.Container | null {
    if (this.frame === "mobile-square") {
      return null;
    }

    const name = translate(cardKey(plantModel.nameKey));
    const descriptionLines = translate(cardKey(plantModel.descriptionKey))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const summary = descriptionLines.find((line) => !/^消耗\s*[:：]/.test(line)) ?? "";
    const text = this.scene.add.text(0, 0, summary ? `${name} · ${summary}` : name, {
      fontFamily: "Arial, sans-serif",
      fontSize: `${Math.max(11, Math.round(this.height * 0.12))}px`,
      color: "#1b1208",
      fontStyle: "bold",
    }).setOrigin(0);

    const maxTextWidth = Math.max(120, Math.round(this.width * 2.2));
    let content = text.text;
    while (text.width > maxTextWidth && content.length > 1) {
      content = content.slice(0, -1);
      text.setText(`${content}…`);
    }

    const padX = 7;
    const padY = 4;
    const radius = 5;
    const tooltipWidth = Math.ceil(text.width) + padX * 2;
    const tooltipHeight = Math.ceil(text.height) + padY * 2;
    const background = this.scene.add.graphics();
    background.fillStyle(0xf2c14e, 1);
    background.fillRoundedRect(0, 0, tooltipWidth, tooltipHeight, radius);
    background.lineStyle(2, 0x6b3f1d, 1);
    background.strokeRoundedRect(0, 0, tooltipWidth, tooltipHeight, radius);
    text.setPosition(padX, padY);

    const tooltip = this.scene.add.container(0, 0, [background, text]);

    tooltip.setPosition((this.width - tooltipWidth) / 2, this.height + 6);
    tooltip.setVisible(false);
    this.container.add(tooltip);
    return tooltip;
  }

  private get expensive(): boolean {
    return this.energy < this.cost;
  }

  private canPress(): boolean {
    if (!CardpileManager.Instance.CouldOperateCardpile() || !this.reloaded) {
      return false;
    }
    return !(this.disableWhenExpensive && this.expensive);
  }

  private handleClick() {
    if (!CardpileManager.Instance.CouldOperateCardpile() || !this.reloaded) {
      return;
    }
    if (this.expensive) {
      if (!this.disableWhenExpensive) {
        PlantsManager.Instance.EventBus.emit("onEnergyInsufficient");
      }
      return;
    }
    CardpileManager.Instance.ClickCard(this.pid, this.level);
  }

  private applyScale() {
    const canHover = this.frame !== "mobile-square";
    this.container.setScale(canHover && this.hovered && this.canPress() ? 1.04 : 1);
  }

  private draw() {
    redrawSlotFrame(
      this.bg,
      this.width,
      this.height,
      SLOT_FILL,
      SLOT_BORDER,
      SLOT_STROKE,
    );
    this.overlay.clear();
    if (this.expensive) {
      this.overlay.fillStyle(0x921f1f, 0.24);
      this.overlay.fillRoundedRect(0, 0, this.width, this.height, slotRadius(this.width, this.height));
    }
    if (!this.reloaded && this.leftPercent > 0) {
      this.overlay.fillStyle(0x111111, 0.62);
      if (this.frame === "mobile-square") {
        const fillWidth = this.width * this.leftPercent;
        this.overlay.fillRoundedRect(
          0,
          0,
          fillWidth,
          this.height,
          Math.min(slotRadius(this.width, this.height), fillWidth * 0.5),
        );
      } else {
        const fillHeight = this.height * this.leftPercent;
        this.overlay.fillRoundedRect(
          0,
          0,
          this.width,
          fillHeight,
          Math.min(slotRadius(this.width, this.height), fillHeight * 0.5),
        );
      }
    }
    this.costText?.setColor(this.expensive ? "#ff2f2f" : "#ffffff");
    this.selectionGlow.clear();
    if (this.selected) {
      drawSlotSelectionOutline(this.selectionGlow, this.width, this.height);
    }
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

export class EnergyPanelView {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly width: number;
  private readonly height: number;
  private flashTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Game, x: number, y: number, width: number, height: number) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.container = scene.add.container(x, y).setDepth(DepthHelper.UI.chromeControl());
    this.bg = scene.add.graphics();
    this.container.add(this.bg);
    const icon = scene.add.image(width / 2, height * 0.34, "redstone");
    const iconSize = Math.min(width * 0.52, height * 0.42);
    icon.setDisplaySize(iconSize, iconSize);
    this.container.add(icon);
    this.valueText = scene.add.text(width / 2, height * 0.72, "0", {
      fontFamily: "Arial, sans-serif",
      fontSize: `${Math.max(10, Math.round(height * 0.27))}px`,
      color: "#111111",
      fontStyle: "bold",
    }).setOrigin(0.5);
    this.container.add(this.valueText);
    redrawSlotFrame(this.bg, width, height, 0xf0f0f0);
  }

  public setEnergy(energy: number) {
    this.valueText.setText(String(energy));
    setTextSizeToFit(
      this.valueText,
      this.width * 0.72,
      Math.max(10, Math.round(this.height * 0.27)),
      9,
    );
  }

  /** 调试/E2E：当前能量面板显示的数字文本。 */
  public getEnergyText(): string {
    return this.valueText.text;
  }

  public flashInsufficient() {
    this.valueText.setColor("#f44336");
    this.flashTimer?.remove(false);
    this.flashTimer = this.scene.time.delayedCall(350, () => {
      this.valueText.setColor("#111111");
      this.flashTimer = null;
    });
  }

  public destroy() {
    this.flashTimer?.remove(false);
    this.container.destroy(true);
  }
}

export class ToolButtonView {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly selectionGlow: Phaser.GameObjects.Graphics;
  private readonly width: number;
  private readonly height: number;
  private readonly allowHover: boolean;
  private selected = false;
  private hovered = false;
  private selectionTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Game,
    x: number,
    y: number,
    width: number,
    height: number,
    allowHover = true,
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.allowHover = allowHover;
    this.container = scene.add.container(x, y).setDepth(DepthHelper.UI.chromeControl());
    this.bg = scene.add.graphics();
    this.selectionGlow = scene.add.graphics();
    this.container.add(this.bg);
    const iconSize = Math.min(width, height) * 0.62;
    if (scene.textures.exists("pickaxe")) {
      const icon = scene.add.image(width / 2, height / 2, "pickaxe");
      icon.setDisplaySize(iconSize, iconSize);
      this.container.add(icon);
    }
    this.container.add(this.selectionGlow);
    const hitZone = scene.add.zone(width / 2, height / 2, width, height)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.container.add(hitZone);
    hitZone.on("pointerover", () => {
      if (!this.allowHover) {
        return;
      }
      this.hovered = true;
      this.applyScale();
    });
    hitZone.on("pointerout", () => {
      if (!this.allowHover) {
        return;
      }
      this.hovered = false;
      this.applyScale();
    });
    hitZone.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      if (CardpileManager.Instance.CouldOperateCardpile()) {
        this.container.setScale(0.97);
      }
    });
    hitZone.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      this.applyScale();
      CardpileManager.Instance.ClickPickaxe();
    });
    this.draw();
  }

  public setSelected(selected: boolean) {
    if (this.selected === selected) {
      return;
    }
    this.selected = selected;
    this.syncSelectionTween();
    this.draw();
  }

  public destroy() {
    this.selectionTween?.remove();
    this.selectionTween = null;
    this.container.destroy(true);
  }

  private applyScale() {
    this.container.setScale(
      this.allowHover && this.hovered && CardpileManager.Instance.CouldOperateCardpile()
        ? 1.04
        : 1,
    );
  }

  private draw() {
    redrawSlotFrame(
      this.bg,
      this.width,
      this.height,
      SLOT_FILL,
      SLOT_BORDER,
      SLOT_STROKE,
    );
    this.selectionGlow.clear();
    if (this.selected) {
      drawSlotSelectionOutline(this.selectionGlow, this.width, this.height);
    }
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

export function drawChromePanel(scene: Game, x: number, y: number, width: number, height: number) {
  const graphics = scene.add.graphics().setDepth(UI_CHROME_DEPTH);
  graphics.fillStyle(PANEL_BG, 1);
  graphics.fillRect(x, y, width, height);
  graphics.lineStyle(2, PANEL_BORDER, 0.55);
  graphics.strokeRect(x, y, width, height);
  return graphics;
}

export type CardSlotsController = {
  cards: PlantCardView[];
  pickaxe: ToolButtonView | null;
};

export function createCardSlotsController(
  scene: Game,
  layout: CardSlotChromeLayout,
): CardSlotsController {
  const cards = layout.cards.slots.flatMap((slot) => {
    const plant = scene.params.plants[slot.index];
    const plantModel = plant ? PlantLibrary.GetModel(plant.pid) : null;
    if (!plant || !plantModel) {
      return [];
    }
    return [new PlantCardView({
      scene,
      slot,
      plantModel,
      level: plant.level,
      disableWhenExpensive: slot.frame === "mobile-square",
    })];
  });
  const pickaxe = new ToolButtonView(
    scene,
    layout.pickaxe.x,
    layout.pickaxe.y,
    layout.pickaxe.width,
    layout.pickaxe.height,
    layout.pickaxe.frame !== "mobile-square",
  );
  return { cards, pickaxe };
}

export function updateCardSlotsSelection(controller: CardSlotsController) {
  const choice = CardpileManager.Instance.GetCurrentChoice();
  for (const card of controller.cards) {
    card.setSelected(choice.type === "plant" && choice.pid === card.pid);
  }
  controller.pickaxe?.setSelected(choice.type === "pickaxe");
}

export function getPcLayout(deviceType: string, cardCount: number) {
  const chrome = PositionManager.Instance.getSceneChromeLayout(deviceType);
  return getPcCardSlotChromeLayout(
    chrome.topCardSlot,
    cardCount,
  );
}
