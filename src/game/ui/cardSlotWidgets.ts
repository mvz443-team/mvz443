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

/** 预渲染卡槽皮肤纹理的版本号：改样式常量时递增，避免复用旧纹理。 */
const SLOT_SKIN_VERSION = "v1";

function slotSkinKey(
  kind: "fill" | "stroke",
  width: number,
  height: number,
  radius: number,
  stroke: number,
): string {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  return `slot-skin/${SLOT_SKIN_VERSION}/${kind}/${w}x${h}/r${r.toFixed(1)}/s${stroke}`;
}

/**
 * 卡槽底板/描边改成一次性预渲染的白色纹理，靠 `setTint` 上色。
 *
 * Phaser 的 Graphics 每次渲染都要重新三角化路径（earcut）并重传顶点缓冲，
 * 这是纯 JS 成本，卡槽越多越慢；iOS Safari 上它是卡槽 UI 掉帧的主因。
 * 换成 Image 后所有卡牌共享同一张纹理，顶点由 MultiPipeline 统一批处理，
 * 渲染成本与卡片数量基本解耦。
 *
 * `stroke` 模式的纹理尺寸即纹理边界，描边路径向内收缩半个线宽，
 * 因此调用方按「期望的路径矩形」传入宽高即可。
 */
function ensureSlotSkin(
  scene: Game,
  kind: "fill" | "stroke",
  width: number,
  height: number,
  radius: number,
  stroke: number,
): string {
  const key = slotSkinKey(kind, width, height, radius, stroke);
  if (scene.textures.exists(key)) return key;
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  if (kind === "fill") {
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(0, 0, w, h, r);
  } else {
    const inset = stroke / 2;
    graphics.lineStyle(stroke, 0xffffff, 1);
    graphics.strokeRoundedRect(inset, inset, w - stroke, h - stroke, Math.max(0, r));
  }
  graphics.generateTexture(key, w, h);
  graphics.destroy();
  return key;
}

type CardArtSpec = {
  width: number;
  height: number;
  radius: number;
  stroke: number;
  fillColor: number;
  expensive: boolean;
  /** 植物卡面纹理 key。 */
  textureKey: string;
  frame: SlotFrameKind;
  costText: string;
};

function colorToCss(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * 卡槽静态外观（底色 + 边框 + 植物图 + 价格）一次性烘焙成一张 canvas 纹理。
 *
 * 原来的实现是 2 个 Graphics + 1 个 Image + 1 个 Text：每张卡每帧至少 4 次
 * draw call，Graphics 还要每帧重新三角化；15 张卡就是 60+ 次 draw call，
 * iOS Safari 上会明显掉帧。烘焙后每张卡静态部分只剩 1 次 draw call，
 * 且同尺寸/同状态的卡牌共享纹理。
 *
 * 冷却遮罩与选中高亮仍需动态表现，单独保留为 Image。
 */
function ensureCardArtSkin(scene: Game, spec: CardArtSpec): string {
  const w = Math.max(1, Math.ceil(spec.width));
  const h = Math.max(1, Math.ceil(spec.height));
  const r = Math.max(0, Math.min(spec.radius, Math.min(w, h) / 2));
  const key = `slot-skin/${SLOT_SKIN_VERSION}/art/${spec.textureKey}/${w}x${h}/r${r.toFixed(1)}/f${spec.fillColor}/${spec.expensive ? "e" : "n"}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, w, h);
  if (!texture) {
    // 极端情况下 canvas 纹理创建失败：退回纯底板纹理，至少不抛异常。
    return ensureSlotSkin(scene, "fill", spec.width, spec.height, spec.radius, spec.stroke);
  }
  const ctx = texture.getContext();

  // 底色
  traceRoundedRect(ctx, 0, 0, w, h, r);
  ctx.fillStyle = colorToCss(spec.fillColor);
  ctx.fill();

  // 边框（先画，避免压住植物图与价格）
  const inset = spec.stroke / 2;
  traceRoundedRect(ctx, inset, inset, w - spec.stroke, h - spec.stroke, Math.max(0, r - inset));
  ctx.lineWidth = spec.stroke;
  ctx.strokeStyle = colorToCss(SLOT_BORDER);
  ctx.stroke();

  // 植物图
  const artFrame = scene.textures.getFrame(spec.textureKey);
  const artSource = artFrame?.source?.image as CanvasImageSource | undefined;
  if (artFrame && artSource) {
    const layout = getArtLayout(spec.frame, spec.width, spec.height);
    const srcW = artFrame.cutWidth || artFrame.width;
    const srcH = artFrame.cutHeight || artFrame.height;
    const rawScale = Math.min(layout.maxWidth / srcW, layout.maxHeight / srcH);
    const drawScale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
    const drawWidth = srcW * drawScale;
    const drawHeight = srcH * drawScale;
    ctx.drawImage(
      artSource,
      artFrame.cutX,
      artFrame.cutY,
      srcW,
      srcH,
      layout.x - drawWidth / 2,
      layout.y - drawHeight / 2,
      drawWidth,
      drawHeight,
    );
  }

  // 能量不足红层：与原实现一致，压在植物图之上、价格之下
  if (spec.expensive) {
    traceRoundedRect(ctx, 0, 0, w, h, r);
    ctx.fillStyle = "rgba(146, 31, 31, 0.24)";
    ctx.fill();
  }

  // 价格
  const costLayout = getCostLayout(spec.frame, spec.width, spec.height);
  let fontSize = costLayout.fontSize;
  const fontOf = (size: number) => `bold ${size}px Arial, sans-serif`;
  ctx.font = fontOf(fontSize);
  while (ctx.measureText(spec.costText).width > costLayout.maxWidth && fontSize > 8) {
    fontSize -= 1;
    ctx.font = fontOf(fontSize);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = costLayout.strokeWidth;
  ctx.strokeStyle = "#111111";
  ctx.strokeText(spec.costText, costLayout.x, costLayout.y);
  ctx.fillStyle = spec.expensive ? "#ff2f2f" : "#ffffff";
  ctx.fillText(spec.costText, costLayout.x, costLayout.y);

  texture.refresh();
  return key;
}

function setTextSizeToFit(
  text: Phaser.GameObjects.Text,
  maxWidth: number,
  preferred: number,
  minSize: number,
) {
  let size = preferred;
  text.setFontSize(size);
  // 每次 setFontSize 都会重跑 MeasureText + updateText，宽度够时立刻返回。
  if (text.width <= maxWidth) return;
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
  private readonly artTextureKey: string;
  private readonly container: Phaser.GameObjects.Container;
  /**
   * 卡槽静态外观（底色 + 边框 + 植物图 + 价格）烘焙成一张纹理。
   *
   * 原来这些是 2 个 Graphics + 1 个 Image + 1 个 Text，每张卡每帧至少 4 次
   * draw call 且 Graphics 还要每帧三角化；15 张卡就是 60+ 次 draw call，
   * iOS Safari 上直接掉帧。烘焙后每张卡静态部分只有 1 次 draw call。
   */
  private readonly skin: Phaser.GameObjects.Image;
  /**
   * 冷却遮罩：满尺寸纹理只取一次，之后按 `leftPercent` 只做 transform 缩放。
   * 冷却进度每个逻辑步都在变，若每步重建几何，15 张卡就是每步 15 次重建 + 重传。
   */
  private readonly coolingMask: Phaser.GameObjects.Image;
  private readonly selectionGlow: Phaser.GameObjects.Image;
  private readonly tooltip: Phaser.GameObjects.Container | null;
  private readonly hitZone: Phaser.GameObjects.Zone;
  private energy = 0;
  private reloaded = false;
  private leftPercent = 1;
  private selected = false;
  private hovered = false;
  private selectionTween: Phaser.Tweens.Tween | null = null;
  // 绘制脏标记：只有这些值真的变化时才换纹理 / 改可见性。
  private skinKey = "";
  private drawnSelected: boolean | null = null;
  private drawnLeftPercent = -1;
  /** `setDisplaySize` 写入的基础缩放，冷却进度缩放要在它之上叠加。 */
  private maskBaseScaleX = 1;
  private maskBaseScaleY = 1;

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
    this.artTextureKey = getCardTextureKey(this.scene, options.plantModel);
    this.container = this.scene.add.container(options.slot.x, options.slot.y)
      .setDepth(DepthHelper.UI.chromeControl());
    this.scene.registerCardBandObject(this.container);
    const skinKey = this.buildSkinKey(false, false);
    this.skin = this.scene.add.image(0, 0, skinKey)
      .setOrigin(0, 0)
      .setDisplaySize(this.width, this.height);
    this.skinKey = skinKey;
    this.container.add(this.skin);
    const maskKey = ensureSlotSkin(this.scene, "fill", this.width, this.height, this.radius, SLOT_STROKE);
    this.coolingMask = this.scene.add.image(0, 0, maskKey)
      .setOrigin(0, 0)
      .setDisplaySize(this.width, this.height)
      .setTint(0x111111)
      .setAlpha(SLOT_MASK_ALPHA)
      .setVisible(false);
    this.container.add(this.coolingMask);
    this.maskBaseScaleX = this.coolingMask.scaleX;
    this.maskBaseScaleY = this.coolingMask.scaleY;
    const glowStroke = Math.max(3, Math.min(5, this.width * 0.07));
    const glowWidth = this.width + 4 + glowStroke;
    const glowHeight = this.height + 4 + glowStroke;
    const glowKey = ensureSlotSkin(this.scene, "stroke", glowWidth, glowHeight, this.radius + 2, glowStroke);
    this.selectionGlow = this.scene.add.image(-2 - glowStroke / 2, -2 - glowStroke / 2, glowKey)
      .setOrigin(0, 0)
      .setDisplaySize(glowWidth, glowHeight)
      .setTint(SLOT_BORDER_CHOSEN)
      .setVisible(false);
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
    if (this.energy === energy) return;
    this.energy = energy;
    this.draw();
  }

  public setCooldown(hasReloaded: boolean, leftPercent: number) {
    const nextPercent = Math.max(0, Math.min(1, leftPercent));
    // `onCooldownStatus` 每个逻辑步都广播一次；冷却完成、进度没变时必须直接返回，
    // 否则 15 张卡会每秒触发 300 次无效重绘。
    if (this.reloaded === hasReloaded && this.leftPercent === nextPercent) return;
    this.reloaded = hasReloaded;
    this.leftPercent = nextPercent;
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

  private buildSkinKey(cooling: boolean, expensive: boolean): string {
    return ensureCardArtSkin(this.scene, {
      width: this.width,
      height: this.height,
      radius: this.radius,
      stroke: SLOT_STROKE,
      fillColor: this.getFillColor(cooling),
      expensive,
      textureKey: this.artTextureKey,
      frame: this.frame,
      costText: String(this.cost),
    });
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
    // 纹理已被回收，改 tint / 可见性会抛异常。表现层异常必须吞掉。
    if (!this.container?.scene || !this.skin?.scene || !this.coolingMask?.scene || !this.selectionGlow?.scene) return;
    try {
      const cooling = !this.reloaded && this.leftPercent > 0;
      const expensive = this.expensive;

      // 底色/边框/植物图/价格烘焙在同一张纹理里，状态变化时只换纹理。
      const skinKey = this.buildSkinKey(cooling, expensive);
      if (skinKey !== this.skinKey) {
        this.skin.setTexture(skinKey);
        this.skin.setDisplaySize(this.width, this.height);
        this.skinKey = skinKey;
      }

      this.syncCoolingMask(cooling);

      if (this.selected !== this.drawnSelected) {
        this.selectionGlow.setVisible(this.selected);
        this.drawnSelected = this.selected;
      }
    } catch (error) {
      console.warn("[PlantCardView] draw skipped because the view is no longer available.", error);
    }
  }

  /**
   * 冷却遮罩进度：满尺寸纹理只取一次，之后只用 `setScale` 表达剩余比例。
   * 缩放围绕 Image 的 origin(0,0)，因此移动端横向收缩、PC 纵向收缩都从左上开始，
   * 与原实现按比例画小矩形的方向一致。基础缩放来自 `setDisplaySize`，必须乘回去。
   */
  private syncCoolingMask(cooling: boolean) {
    const mask = this.coolingMask;
    if (!cooling) {
      if (mask.visible) mask.setVisible(false);
      // 下次冷却需要重新设置一次缩放，避免沿用上一轮的百分比。
      this.drawnLeftPercent = -1;
      return;
    }
    if (!mask.visible) mask.setVisible(true);
    if (this.drawnLeftPercent === this.leftPercent) return;
    if (this.frame === "mobile-square") {
      mask.setScale(this.maskBaseScaleX * this.leftPercent, this.maskBaseScaleY);
    } else {
      mask.setScale(this.maskBaseScaleX, this.maskBaseScaleY * this.leftPercent);
    }
    this.drawnLeftPercent = this.leftPercent;
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
  /** 上次渲染的能量值：相同就不必重跑 setText + 字号自适应。 */
  private lastEnergy: number | null = null;

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
    // 同一数值重复推送（资源预演/回滚恢复会多次广播）时跳过整段 canvas 重绘。
    if (this.lastEnergy === energy) return;
    this.lastEnergy = energy;
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
