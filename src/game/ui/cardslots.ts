import type { Game } from "../scenes/Game";
import DepthUtils from "../../utils/depth";
import { PositionManager } from "../managers/view/PositionManager";
import CardpileManager from "../managers/combat/CardpileManager";
import ResourceManager from "../managers/combat/ResourceManager";
import PlantsManager from "../managers/combat/PlantsManager";
import { PlantLibrary } from "../managers/library/PlantLibrary";
import type { PlantModel } from "../models/PlantModel";
import { getLevelBadgeTextureKey } from "./levelBadgeSvg";

export const UI_CHROME_DEPTH = DepthUtils.getInGameUIElementDepth(80);

type CardOrientation = "vertical" | "mobile";

type CardViewOptions = {
  scene: Game;
  x: number;
  y: number;
  width: number;
  height: number;
  plantModel: PlantModel;
  level: number;
  orientation: CardOrientation;
  disableWhenExpensive?: boolean;
};

const CARD_RADIUS = 6;
const CARD_STROKE = 2;
const CARD_BG = 0xf6f6f6;
const CARD_BG_COOLING = 0xd3d3d3;
const CARD_BG_EXPENSIVE = 0xce7f7f;
const CARD_BORDER = 0x333333;
const CARD_BORDER_CHOSEN = 0xffee22;
const PANEL_BG = 0x303030;
const PANEL_BORDER = 0x111111;

function stopInput(event?: Phaser.Types.Input.EventData) {
  event?.stopPropagation();
}

function redrawRoundedPanel(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  fillColor: number,
  lineColor = CARD_BORDER,
  lineWidth = CARD_STROKE,
  alpha = 1,
  radius = CARD_RADIUS,
) {
  graphics.clear();
  graphics.fillStyle(fillColor, alpha);
  graphics.fillRoundedRect(0, 0, width, height, radius);
  graphics.lineStyle(lineWidth, lineColor, 1);
  graphics.strokeRoundedRect(0, 0, width, height, radius);
}

function setTextSizeToFit(text: Phaser.GameObjects.Text, maxWidth: number, preferred: number, minSize: number) {
  let size = preferred;
  text.setFontSize(size);

  while (text.width > maxWidth && size > minSize) {
    size -= 1;
    text.setFontSize(size);
  }
}

function getCardTextureKey(scene: Game, plantModel: PlantModel): string {
  const cardKey = `card/${plantModel.texturePath}`;
  if (scene.textures.exists(cardKey)) {
    return cardKey;
  }
  return plantModel.texturePath;
}

function addLevelBadge(
  scene: Game,
  container: Phaser.GameObjects.Container,
  level: number,
  x: number,
  y: number,
  size: number,
) {
  const textureKey = getLevelBadgeTextureKey(level);
  if (!scene.textures.exists(textureKey)) {
    return;
  }
  const badge = scene.add.image(x, y, textureKey);
  badge.setDisplaySize(size, size);
  container.add(badge);
}

export class PlantCardView {
  public readonly pid: number;
  public readonly level: number;
  public readonly cost: number;

  private readonly scene: Game;
  private readonly width: number;
  private readonly height: number;
  private readonly orientation: CardOrientation;
  private readonly disableWhenExpensive: boolean;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly hitZone: Phaser.GameObjects.Zone;
  private energy = 0;
  private reloaded = false;
  private leftPercent = 1;
  private selected = false;
  private hovered = false;

  constructor(options: CardViewOptions) {
    this.scene = options.scene;
    this.width = options.width;
    this.height = options.height;
    this.orientation = options.orientation;
    this.disableWhenExpensive = options.disableWhenExpensive ?? false;
    this.pid = options.plantModel.pid;
    this.level = options.level;
    this.cost = options.plantModel.cost.getValueAt(options.level);

    this.container = this.scene.add.container(options.x, options.y).setDepth(UI_CHROME_DEPTH + 2);
    this.bg = this.scene.add.graphics();
    this.overlay = this.scene.add.graphics();
    this.container.add(this.bg);

    this.addPlantImage(options.plantModel);
    this.addCostText();

    if (this.orientation === "vertical") {
      addLevelBadge(this.scene, this.container, this.level, 14, 14, Math.min(24, this.width * 0.35));
    }

    this.container.add(this.overlay);
    this.hitZone = this.scene.add.zone(this.width / 2, this.height / 2, this.width, this.height)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.container.add(this.hitZone);

    this.hitZone.on("pointerover", () => {
      this.hovered = true;
      this.applyScale();
    });
    this.hitZone.on("pointerout", () => {
      this.hovered = false;
      this.applyScale();
    });
    this.hitZone.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      if (this.canPress()) {
        this.container.setScale(0.96);
      }
    });
    this.hitZone.on("pointerup", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      this.applyScale();
      this.handleClick();
    });

    this.draw();
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
    this.selected = selected;
    this.draw();
  }

  public destroy() {
    this.container.destroy(true);
  }

  private addPlantImage(plantModel: PlantModel) {
    const textureKey = getCardTextureKey(this.scene, plantModel);
    const isVertical = this.orientation === "vertical";
    const imageAreaHeight = isVertical ? this.height * 0.74 : this.height * 0.9;
    const imageAreaWidth = isVertical ? this.width : this.width * 0.72;
    const imageX = isVertical ? this.width / 2 : imageAreaWidth * 0.5;
    const imageY = isVertical ? imageAreaHeight * 0.48 : this.height * 0.5;
    const image = this.scene.add.image(imageX, imageY, textureKey);
    const maxW = imageAreaWidth * 0.9;
    const maxH = imageAreaHeight * 0.86;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    image.setScale(Number.isFinite(scale) ? scale : 1);
    this.container.add(image);
  }

  private addCostText() {
    const isVertical = this.orientation === "vertical";
    const text = this.scene.add.text(
      isVertical ? this.width / 2 : this.width * 0.82,
      isVertical ? this.height * 0.88 : this.height * 0.7,
      String(this.cost),
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.max(10, Math.round(this.height * (isVertical ? 0.16 : 0.28)))}px`,
        color: "#222222",
        fontStyle: "bold",
      },
    ).setOrigin(0.5);
    setTextSizeToFit(
      text,
      isVertical ? this.width * 0.8 : this.width * 0.28,
      Math.max(10, Math.round(this.height * (isVertical ? 0.16 : 0.28))),
      9,
    );
    this.container.add(text);

    if (isVertical) {
      const divider = this.scene.add.graphics();
      divider.lineStyle(2, CARD_BORDER, 1);
      divider.lineBetween(0, this.height * 0.76, this.width, this.height * 0.76);
      this.container.add(divider);
    }
  }

  private get expensive(): boolean {
    return this.energy < this.cost;
  }

  private canPress(): boolean {
    if (!CardpileManager.Instance.CouldOperateCardpile()) {
      return false;
    }
    if (!this.reloaded) {
      return false;
    }
    return !(this.disableWhenExpensive && this.expensive);
  }

  private handleClick() {
    if (!CardpileManager.Instance.CouldOperateCardpile()) {
      return;
    }
    if (!this.reloaded) {
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
    const scale = this.hovered && this.canPress() ? 1.05 : 1;
    this.container.setScale(scale);
  }

  private draw() {
    const fillColor = this.expensive
      ? CARD_BG_EXPENSIVE
      : !this.reloaded
        ? CARD_BG_COOLING
        : CARD_BG;
    const lineColor = this.selected ? CARD_BORDER_CHOSEN : CARD_BORDER;
    const lineWidth = this.selected ? 5 : CARD_STROKE;

    redrawRoundedPanel(this.bg, this.width, this.height, fillColor, lineColor, lineWidth);
    this.overlay.clear();

    if (!this.reloaded && this.leftPercent > 0) {
      this.overlay.fillStyle(0x404040, 0.68);
      if (this.orientation === "mobile") {
        const overlayWidth = this.width * this.leftPercent;
        const radius = Math.min(CARD_RADIUS, overlayWidth * 0.5, this.height * 0.5);
        this.overlay.fillRoundedRect(this.width - overlayWidth, 0, overlayWidth, this.height, radius);
      } else {
        const overlayHeight = this.height * this.leftPercent;
        const radius = Math.min(CARD_RADIUS, overlayHeight * 0.5, this.width * 0.5);
        this.overlay.fillRoundedRect(0, this.height - overlayHeight, this.width, overlayHeight, radius);
      }
    }
  }
}

export class EnergyPanelView {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly width: number;
  private readonly height: number;
  private readonly compact: boolean;
  private flashTimer: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Game, x: number, y: number, width: number, height: number, compact = false) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.compact = compact;
    this.container = this.scene.add.container(x, y).setDepth(UI_CHROME_DEPTH + 2);
    this.bg = this.scene.add.graphics();
    redrawRoundedPanel(this.bg, width, height, 0xf0f0f0, CARD_BORDER, 2);
    this.container.add(this.bg);

    const icon = this.scene.add.image(
      compact ? width * 0.28 : width / 2,
      compact ? height / 2 : height * 0.42,
      "redstone",
    );
    const iconMax = compact ? Math.min(width * 0.32, height * 0.55) : Math.min(width * 0.58, height * 0.44);
    icon.setDisplaySize(iconMax, iconMax);
    this.container.add(icon);

    this.valueText = this.scene.add.text(
      compact ? width * 0.68 : width / 2,
      compact ? height / 2 : height * 0.76,
      "0",
      {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.max(13, Math.round(height * (compact ? 0.34 : 0.22)))}px`,
        color: "#111111",
        fontStyle: "bold",
      },
    ).setOrigin(0.5);
    this.container.add(this.valueText);
  }

  public setEnergy(energy: number) {
    this.valueText.setText(String(energy));
    setTextSizeToFit(this.valueText, this.width * 0.72, Math.max(13, Math.round(this.height * (this.compact ? 0.34 : 0.22))), 10);
  }

  public flashInsufficient() {
    this.valueText.setColor("#f44336");
    this.flashTimer?.remove(false);
    this.flashTimer = this.scene.time.delayedCall(this.compact ? 350 : 800, () => {
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
  private readonly width: number;
  private readonly height: number;
  private selected = false;
  private hovered = false;

  constructor(
    scene: Game,
    x: number,
    y: number,
    width: number,
    height: number,
    mode: "image" | "text",
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.container = this.scene.add.container(x, y).setDepth(UI_CHROME_DEPTH + 2);
    this.bg = this.scene.add.graphics();
    this.container.add(this.bg);

    if (mode === "image" && this.scene.textures.exists("pickaxe")) {
      const icon = this.scene.add.image(width / 2, height / 2, "pickaxe");
      const iconSize = Math.min(width, height) * 0.74;
      icon.setDisplaySize(iconSize, iconSize);
      this.container.add(icon);
    } else {
      const text = this.scene.add.text(width / 2, height / 2, "pickaxe", {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.max(10, Math.round(height * 0.24))}px`,
        color: "#222222",
        fontStyle: "bold",
      }).setOrigin(0.5);
      setTextSizeToFit(text, width * 0.82, Math.max(10, Math.round(height * 0.24)), 8);
      this.container.add(text);
    }

    const hitZone = this.scene.add.zone(width / 2, height / 2, width, height)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.container.add(hitZone);
    hitZone.on("pointerover", () => {
      this.hovered = true;
      this.applyScale();
    });
    hitZone.on("pointerout", () => {
      this.hovered = false;
      this.applyScale();
    });
    hitZone.on("pointerdown", (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      stopInput(event);
      if (CardpileManager.Instance.CouldOperateCardpile()) {
        this.container.setScale(0.96);
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
    this.selected = selected;
    this.draw();
  }

  public destroy() {
    this.container.destroy(true);
  }

  private applyScale() {
    const scale = this.hovered && CardpileManager.Instance.CouldOperateCardpile() ? 1.05 : 1;
    this.container.setScale(scale);
  }

  private draw() {
    redrawRoundedPanel(
      this.bg,
      this.width,
      this.height,
      CARD_BG,
      this.selected ? CARD_BORDER_CHOSEN : CARD_BORDER,
      this.selected ? 5 : CARD_STROKE,
    );
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

export class CardSlots {
  private readonly scene: Game;
  private readonly cards: PlantCardView[] = [];
  private readonly panels: Phaser.GameObjects.Graphics[] = [];
  private readonly unsubs: Array<() => void> = [];
  private energyPanel: EnergyPanelView | null = null;
  private pickaxe: ToolButtonView | null = null;

  constructor(scene: Game) {
    this.scene = scene;
    this.create();
    this.bindEvents();
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  public destroy = () => {
    for (const unsub of this.unsubs.splice(0)) {
      unsub();
    }
    for (const card of this.cards.splice(0)) {
      card.destroy();
    }
    for (const panel of this.panels.splice(0)) {
      panel.destroy();
    }
    this.energyPanel?.destroy();
    this.energyPanel = null;
    this.pickaxe?.destroy();
    this.pickaxe = null;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  };

  private create() {
    const layout = PositionManager.Instance.getSceneChromeLayout("pc");
    const top = layout.topCardSlot;
    const right = layout.rightCardSlot;
    this.panels.push(drawChromePanel(this.scene, top.x, top.y, top.width, top.height));
    this.panels.push(drawChromePanel(this.scene, right.x, right.y, right.width, right.height));

    const pad = 0;
    const gap = 6;
    const energyWidth = Math.max(66, top.height * 0.72);
    const cardHeight = top.height;
    const cardWidth = Math.min(86, cardHeight * 0.8);
    const pickaxeSize = Math.min(cardHeight, cardWidth);

    this.energyPanel = new EnergyPanelView(this.scene, top.x, top.y, energyWidth, cardHeight);

    const plants = this.scene.params.plants;
    const topStartX = top.x + energyWidth + gap;
    const topAvailableWidth = top.width - (topStartX - top.x);
    const maxTopCards = Math.max(0, Math.floor((topAvailableWidth + gap) / (cardWidth + gap)));
    const topPlants = plants.slice(0, maxTopCards);
    const rightPlants = plants.slice(maxTopCards);

    let cursorX = topStartX;
    for (const plant of topPlants) {
      const model = PlantLibrary.GetModel(plant.pid);
      if (!model) {
        continue;
      }
      this.cards.push(new PlantCardView({
        scene: this.scene,
        x: cursorX,
        y: top.y,
        width: cardWidth,
        height: cardHeight,
        plantModel: model,
        level: plant.level,
        orientation: "vertical",
      }));
      cursorX += cardWidth + gap;
    }

    const canFitPickaxeTop = cursorX + pickaxeSize <= top.x + top.width;
    const rightPad = 0;
    const rightGap = 6;
    const rightItemCount = rightPlants.length + 1;
    const rightCardHeight = Math.max(
      52,
      Math.min(96, (right.height - rightPad * 2 - rightGap * Math.max(0, rightItemCount - 1)) / Math.max(1, rightItemCount)),
    );
    const rightCardWidth = right.width;
    const rightCardX = right.x;
    let rightY = right.y + rightPad;

    for (const plant of rightPlants) {
      const model = PlantLibrary.GetModel(plant.pid);
      if (!model) {
        continue;
      }
      this.cards.push(new PlantCardView({
        scene: this.scene,
        x: rightCardX,
        y: rightY,
        width: rightCardWidth,
        height: rightCardHeight,
        plantModel: model,
        level: plant.level,
        orientation: "vertical",
      }));
      rightY += rightCardHeight + rightGap;
    }

    if (rightPlants.length === 0 && canFitPickaxeTop) {
      this.pickaxe = new ToolButtonView(
        this.scene,
        cursorX,
        top.y + (cardHeight - pickaxeSize) / 2,
        pickaxeSize,
        pickaxeSize,
        "image",
      );
    } else {
      const y = rightPlants.length > 0 ? rightY : top.height + rightPad;
      this.pickaxe = new ToolButtonView(this.scene, rightCardX, y, rightCardWidth, Math.min(rightCardHeight, rightCardWidth), "image");
    }

    this.updateEnergy(ResourceManager.Instance.getDisplayEnergy("mine"));
    this.updateSelection();
  }

  private bindEvents() {
    this.unsubs.push(ResourceManager.Instance.Eventbus.on("onEnergyUpdate", () => {
      this.updateEnergy(ResourceManager.Instance.getDisplayEnergy("mine"));
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onCooldownStatus", (status) => {
      this.updateCooldown(status);
    }));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenCard", () => this.updateSelection()));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenPickaxe", () => this.updateSelection()));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onChosenStarShards", () => this.updateSelection()));
    this.unsubs.push(CardpileManager.Instance.EventBus.on("onCancelChosen", () => this.updateSelection()));
    this.unsubs.push(PlantsManager.Instance.EventBus.on("onEnergyInsufficient", () => {
      this.energyPanel?.flashInsufficient();
    }));
  }

  private updateEnergy(energy: number) {
    this.energyPanel?.setEnergy(energy);
    for (const card of this.cards) {
      card.setEnergy(energy);
    }
  }

  private updateCooldown(status: Map<number, { hasReloaded: boolean; leftPercent: number }>) {
    for (const card of this.cards) {
      const cardStatus = status.get(card.pid);
      if (cardStatus) {
        card.setCooldown(cardStatus.hasReloaded, cardStatus.leftPercent);
      }
    }
  }

  private updateSelection() {
    const choice = CardpileManager.Instance.GetCurrentChoice();
    for (const card of this.cards) {
      card.setSelected(choice.type === "plant" && choice.pid === card.pid);
    }
    this.pickaxe?.setSelected(choice.type === "pickaxe");
  }
}
