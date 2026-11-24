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
  SLOT_BORDER_CHOSEN,
  SLOT_FILL,
  SLOT_FILL_COOLING,
  SLOT_MASK_ALPHA,
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

/**
 * 卡槽圆角：移动端同一列卡槽上下紧贴（`MOBILE_SLOT_ROW_GAP = 0`），
 * 默认的大圆角会在贴合处露出两个月牙缝，看起来仍像有 gap；
 * 因此移动端方槽收敛到很小的圆角，PC 保持原样。
 */
function frameRadius(frame: SlotFrameKind, width: number, height: number): number {
  return frame === "mobile-square"
    ? Math.min(3, width * 0.08, height * 0.08)
    : slotRadius(width, height);
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
  private readonly radius: number;
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
    this.radius = frameRadius(this.frame, this.width, this.height);
    this.disableWhenExpensive = options.disableWhenExpensive ?? false;
    this.pid = options.plantModel.pid;
    this.level = options.level;
    this.cost = options.plantModel.cost.getValueAt(options.level);
    this.container = this.scene.add.container(options.slot.x, options.slot.y)
      .setDepth(DepthHelper.UI.chromeControl());
    this.scene.registerCardBandObject(this.container);
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
    this.scene.unregisterCardBandObject(this.container);
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

  /**
   * 卡槽底色（PC 与移动端共用），只由冷却状态决定：
   * - 冷却完成：正常浅色（能量不足时另叠红色）；
   * - 冷却中：灰色，浅于冷却遮罩、深于可用态。
   * 能量是否足够不再改变底色，避免出现"能量不足 + 冷却中"的独立配色。
   */
  private getFillColor(cooling: boolean): number {
    return cooling ? SLOT_FILL_COOLING : SLOT_FILL;
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
    // 单例 manager 的事件总线跨对局存活；若残留订阅驱动到已销毁的卡牌，
    // Graphics/Text 的 CanvasTexture 已被回收，重绘会抛 drawImage 空指针。
    // 与 EnergyPanelView.setEnergy 一致：表现层异常必须吞掉。
    if (!this.container?.scene || !this.overlay?.scene || !this.selectionGlow?.scene) return;
    try {
      const cooling = !this.reloaded && this.leftPercent > 0;
      redrawSlotFrame(
        this.bg,
        this.width,
        this.height,
        this.getFillColor(cooling),
        SLOT_BORDER,
        SLOT_STROKE,
        this.radius,
      );
      this.overlay.clear();
      // 能量不足统一叠浅红，冷却与否只由遮罩表达。
      if (this.expensive) {
        this.overlay.fillStyle(0x921f1f, 0.24);
        this.overlay.fillRoundedRect(0, 0, this.width, this.height, this.radius);
      }
      if (cooling) {
        this.overlay.fillStyle(0x111111, SLOT_MASK_ALPHA);
        if (this.frame === "mobile-square") {
          const fillWidth = this.width * this.leftPercent;
          this.overlay.fillRoundedRect(
            0,
            0,
            fillWidth,
            this.height,
            Math.min(this.radius, fillWidth * 0.5),
          );
        } else {
          const fillHeight = this.height * this.leftPercent;
          this.overlay.fillRoundedRect(
            0,
            0,
            this.width,
            fillHeight,
            Math.min(this.radius, fillHeight * 0.5),
          );
        }
      }
      this.costText?.setColor(this.expensive ? "#ff2f2f" : "#ffffff");
      this.selectionGlow.clear();
      if (this.selected) {
        drawSlotSelectionOutline(this.selectionGlow, this.width, this.height, SLOT_BORDER_CHOSEN, this.radius);
      }
    } catch (error) {
      console.warn("[PlantCardView] draw skipped because the view is no longer available.", error);
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

type EnergyContentLayout = {
  icon: { x: number; y: number; size: number };
  text: { x: number; y: number; fontSize: number; maxWidth: number };
};

/**
 * 能量槽内部排版：
 * - `mobile-square`（移动端侧边栏）：宽扁槽，icon 在左、数字在右横向排列；
 * - `pc-horizontal`（PC 顶部条）：icon 在上、数字在下的竖向排列。
 */
function getEnergyContentLayout(
  frame: SlotFrameKind,
  width: number,
  height: number,
): EnergyContentLayout {
  if (frame === "mobile-square") {
    const size = Math.max(8, Math.min(height * 0.72, width * 0.4));
    return {
      icon: {
        x: Math.max(size * 0.5 + 4, width * 0.26),
        y: height / 2,
        size,
      },
      text: {
        x: width * 0.72,
        y: height / 2,
        fontSize: Math.max(10, Math.round(height * 0.5)),
        maxWidth: width * 0.44,
      },
    };
  }

  return {
    icon: { x: width / 2, y: height * 0.34, size: Math.min(width * 0.52, height * 0.42) },
    text: {
      x: width / 2,
      y: height * 0.72,
      fontSize: Math.max(10, Math.round(height * 0.27)),
      maxWidth: width * 0.72,
    },
  };
}

export class EnergyPanelView {
  private readonly scene: Game;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly valueText: Phaser.GameObjects.Text;
  private readonly width: number;
  private readonly height: number;
  private readonly contentLayout: EnergyContentLayout;
  private flashTimer: Phaser.Time.TimerEvent | null = null;

  constructor(
    scene: Game,
    x: number,
    y: number,
    width: number,
    height: number,
    frame: SlotFrameKind = "pc-horizontal",
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.contentLayout = getEnergyContentLayout(frame, width, height);
    const content = this.contentLayout;
    this.container = scene.add.container(x, y).setDepth(DepthHelper.UI.chromeControl());
    scene.registerCardBandObject(this.container);
    this.bg = scene.add.graphics();
    this.container.add(this.bg);
    const icon = scene.add.image(content.icon.x, content.icon.y, "redstone");
    icon.setDisplaySize(content.icon.size, content.icon.size);
    this.container.add(icon);
    this.valueText = scene.add.text(content.text.x, content.text.y, "0", {
      fontFamily: "Arial, sans-serif",
      fontSize: `${content.text.fontSize}px`,
      color: "#111111",
      fontStyle: "bold",
    }).setOrigin(0.5);
    this.container.add(this.valueText);
    redrawSlotFrame(
      this.bg,
      width,
      height,
      0xf0f0f0,
      SLOT_BORDER,
      SLOT_STROKE,
      frameRadius(frame, width, height),
    );
  }

  public setEnergy(energy: number) {
    // 场景切换/回滚时 Text 的 CanvasTexture 可能已随容器销毁（context=null），
    // 重绘会抛 drawImage 异常。这里属于表现层，必须吞掉异常，否则会中断
    // ApplyPreviewEnergy → handleAttemptPlant，导致点击后无法种植。
    const text = this.valueText;
    if (!text?.scene) return;
    try {
      text.setText(String(energy));
      setTextSizeToFit(
        text,
        this.contentLayout.text.maxWidth,
        this.contentLayout.text.fontSize,
        9,
      );
    } catch (error) {
      console.warn("[EnergyPanelView] setEnergy skipped because the view is no longer available.", error);
    }
  }

  /** 调试/E2E：当前能量面板显示的数字文本。 */
  public getEnergyText(): string {
    return this.valueText.text;
  }

  public flashInsufficient() {
    const text = this.valueText;
    if (!text?.scene || !this.scene?.time) return;
    try {
      text.setColor("#f44336");
      this.flashTimer?.remove(false);
      this.flashTimer = this.scene.time.delayedCall(350, () => {
        if (!this.valueText?.scene) return;
        this.valueText.setColor("#111111");
        this.flashTimer = null;
      });
    } catch (error) {
      console.warn("[EnergyPanelView] flashInsufficient skipped because the view is no longer available.", error);
    }
  }

  public destroy() {
    this.flashTimer?.remove(false);
    this.scene.unregisterCardBandObject(this.container);
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
  private readonly radius: number;
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
    frame: SlotFrameKind = "pc-horizontal",
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.allowHover = allowHover;
    this.radius = frameRadius(frame, width, height);
    this.container = scene.add.container(x, y).setDepth(DepthHelper.UI.chromeControl());
    scene.registerCardBandObject(this.container);
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
    this.scene.unregisterCardBandObject(this.container);
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
      this.radius,
    );
    this.selectionGlow.clear();
    if (this.selected) {
      drawSlotSelectionOutline(this.selectionGlow, this.width, this.height, SLOT_BORDER_CHOSEN, this.radius);
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
  scene.registerCardBandObject(graphics);
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
    layout.pickaxe.frame,
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
