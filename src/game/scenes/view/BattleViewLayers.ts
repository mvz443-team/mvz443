/**
 * 战斗画面摄像机分层。
 *
 * 三个摄像机按渲染顺序：cardBand → battle → ui。
 * - battle：战斗世界（背景、实体）；
 * - cardBand：卡槽带。默认排在 battle 之前，让第 0 行高大怪物可以盖住卡槽；
 * - ui：其余 UI。渲染在最后，始终最上层。
 *
 * 悬停在卡槽带时，卡槽对象从 cardBand 切到 ui（回到最上层）。
 * 移动端没有 hover，且移动端侧边栏的不透明背景位于 ui 层；卡槽若留在 cardBand
 * 会被该背景盖住，因此移动端卡槽始终固定在 ui 层，不参与 hover 切换。
 * 为让第 0 行怪物画进卡槽带，battle 视口向上扩展到 y=0，并用背景遮罩隐藏
 * 原可见顶部以上的地图，避免地图盖住卡槽。
 */
import type { Game } from "../Game";
import { PositionManager } from "../../managers/view/PositionManager";
import DepthHelper from "../../utils/helper/DepthHelper";
import {
  BATTLE_GRID_CELL_HEIGHT,
  BATTLE_GRID_CELL_WIDTH,
  LOGICAL_BATTLE_HEIGHT,
  LOGICAL_BATTLE_WIDTH,
  MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO,
  MOBILE_BATTLE_LEFT_CART_OVERSCAN_COLS,
  MOBILE_BATTLE_RIGHT_OVERSCAN_COLS,
} from "../../../constants/gameLayout";

type CameraLayer = "battle" | "ui" | "cardBand";
type Rect = { x: number; y: number; width: number; height: number };

type BattleCameraView = {
  zoom: number;
  worldViewX: number;
  worldViewY: number;
  scrollX: number;
  scrollY: number;
};

export class BattleViewLayers {
  private readonly scene: Game;
  private readonly background: Phaser.GameObjects.Image;
  private readonly uiDepthThreshold = DepthHelper.UI.threshold();

  private battleCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private uiCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private cardBandCamera: Phaser.Cameras.Scene2D.Camera | null = null;

  private readonly cameraLayerState = new WeakMap<Phaser.GameObjects.GameObject, CameraLayer>();
  private readonly cardBandObjects = new Set<Phaser.GameObjects.GameObject>();
  private cardBandFront = false;
  private cardBandAlwaysFront = false;
  private cardBandHoverRect: Rect | null = null;
  private backgroundMaskShape: Phaser.GameObjects.Graphics | null = null;

  private readonly onCardBandPointer = (pointer: Phaser.Input.Pointer) => {
    if (this.cardBandAlwaysFront) return;
    const rect = this.cardBandHoverRect;
    if (!rect) return;
    const inBand = pointer.x >= rect.x && pointer.x <= rect.x + rect.width
      && pointer.y >= rect.y && pointer.y <= rect.y + rect.height;
    this.setCardBandFront(inBand);
  };

  constructor(scene: Game, background: Phaser.GameObjects.Image) {
    this.scene = scene;
    this.background = background;
  }

  public configure(deviceType: string): void {
    const scene = this.scene;
    // 移动端没有 hover，且侧边栏不透明背景在 ui 层；卡槽必须常驻 ui 才不会被盖住。
    this.cardBandAlwaysFront = deviceType === "mobile";
    this.cardBandFront = this.cardBandAlwaysFront;
    const layout = PositionManager.Instance.getSceneChromeLayout(deviceType);
    const viewport = layout.mainViewport;
    const gridBounds = PositionManager.Instance.getGridBounds();
    const cameraView = deviceType === "mobile"
      ? this.getMobileBattleCameraView(viewport, gridBounds)
      : this.getDesktopBattleCameraView(viewport);

    this.battleCamera = scene.cameras.main;
    this.battleCamera.setName("battle");
    // 先按原视口定位，计算“原可见顶部”对应的世界坐标。
    this.battleCamera.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    this.battleCamera.setZoom(cameraView.zoom);
    this.battleCamera.setScroll(cameraView.scrollX, cameraView.scrollY);
    this.battleCamera.setBackgroundColor("rgba(0,0,0,0)");
    const worldTop = cameraView.worldViewY;

    // 视口向上扩展到 y=0：第 0 行高大怪物的头部也能画进卡槽带；
    // 用 getCameraScrollForWorldView 精确重算 scroll，保证战斗画面位置不变。
    const expandedHeight = viewport.y + viewport.height;
    const expandedScroll = this.getCameraScrollForWorldView(
      cameraView.worldViewX,
      worldTop - viewport.y / cameraView.zoom,
      viewport.width,
      expandedHeight,
      cameraView.zoom,
    );
    this.battleCamera.setViewport(viewport.x, 0, viewport.width, expandedHeight);
    this.battleCamera.setScroll(expandedScroll.scrollX, expandedScroll.scrollY);

    // 背景只保留原可见区域（worldTop 以下），上方透明，避免地图盖住卡槽。
    this.backgroundMaskShape?.destroy();
    const maskShape = scene.make.graphics({ x: 0, y: 0 }, false);
    maskShape.fillStyle(0xffffff, 1);
    maskShape.fillRect(-100000, worldTop, 200000, 200000);
    this.backgroundMaskShape = maskShape;
    this.background.setMask(maskShape.createGeometryMask());

    this.uiCamera = scene.cameras.add(
      0,
      0,
      layout.sceneBounds.width,
      layout.sceneBounds.height,
      false,
      "ui",
    );
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.setZoom(1);
    this.uiCamera.setBackgroundColor("rgba(0,0,0,0)");

    // 卡槽相机：默认排在战斗相机之前（先画卡槽，再画战斗，怪物可盖住卡槽）。
    this.cardBandCamera = scene.cameras.add(
      0,
      0,
      layout.sceneBounds.width,
      layout.sceneBounds.height,
      false,
      "cardBand",
    );
    this.cardBandCamera.setScroll(0, 0);
    this.cardBandCamera.setZoom(1);
    this.cardBandCamera.setBackgroundColor("rgba(0,0,0,0)");
    const cameraList = scene.cameras.cameras;
    const bandIndex = cameraList.indexOf(this.cardBandCamera);
    if (bandIndex > 0) {
      cameraList.splice(bandIndex, 1);
      cameraList.unshift(this.cardBandCamera);
    }

    // 卡槽带悬停区：桌面为顶部条，移动端为左侧卡槽栏。
    const mobileBand = layout.mobileLeftCardSlot?.width > 0
      ? layout.mobileLeftCardSlot
      : layout.leftCardSlot;
    this.cardBandHoverRect = deviceType === "mobile" && mobileBand && mobileBand.width > 0
      ? mobileBand
      : layout.topCardSlot;

    if (!this.cardBandAlwaysFront) {
      scene.input.on("pointermove", this.onCardBandPointer);
      scene.input.on("pointerdown", this.onCardBandPointer);
    }

    this.sync();
  }

  /** 每帧调用：按对象所属层分派到 battle / cardBand / ui 相机。 */
  public sync(): void {
    if (!this.battleCamera || !this.uiCamera) return;

    for (const object of this.scene.children.list) {
      const depth = (object as Phaser.GameObjects.GameObject & { depth?: number }).depth ?? 0;
      let layer: CameraLayer;
      if (this.cardBandObjects.has(object)) {
        layer = this.cardBandFront ? "ui" : "cardBand";
      } else {
        layer = depth >= this.uiDepthThreshold ? "ui" : "battle";
      }
      if (this.cameraLayerState.get(object) === layer) {
        continue;
      }
      this.cameraLayerState.set(object, layer);
      this.applyCameraLayer(object, layer);
    }
  }

  public getBattleWorldPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const camera = this.battleCamera ?? this.scene.cameras.main;
    const point = camera.getWorldPoint(pointer.x, pointer.y);
    return { x: point.x, y: point.y };
  }

  /** 注册卡槽带对象（默认在战斗相机之下；悬停时切到最上层）。 */
  public registerCardBandObject(object: Phaser.GameObjects.GameObject): void {
    this.cardBandObjects.add(object);
    this.cameraLayerState.delete(object);
  }

  public unregisterCardBandObject(object: Phaser.GameObjects.GameObject): void {
    this.cardBandObjects.delete(object);
    this.cameraLayerState.delete(object);
  }

  public destroy(): void {
    this.scene.input?.off("pointermove", this.onCardBandPointer);
    this.scene.input?.off("pointerdown", this.onCardBandPointer);
    this.cardBandHoverRect = null;
    this.cardBandObjects.clear();
    this.cardBandFront = false;
    this.cardBandAlwaysFront = false;
    this.cardBandCamera = null;
    this.backgroundMaskShape?.destroy();
    this.backgroundMaskShape = null;
  }

  private setCardBandFront(front: boolean): void {
    if (this.cardBandFront === front) return;
    this.cardBandFront = front;
    this.sync();
  }

  private applyCameraLayer(object: Phaser.GameObjects.GameObject, layer: CameraLayer): void {
    if (this.battleCamera) this.setCameraIgnore(this.battleCamera, object, layer !== "battle");
    if (this.uiCamera) this.setCameraIgnore(this.uiCamera, object, layer !== "ui");
    if (this.cardBandCamera) this.setCameraIgnore(this.cardBandCamera, object, layer !== "cardBand");
  }

  private setCameraIgnore(
    camera: Phaser.Cameras.Scene2D.Camera,
    object: Phaser.GameObjects.GameObject,
    ignored: boolean,
  ): void {
    if (ignored) {
      camera.ignore(object);
      return;
    }
    object.cameraFilter &= ~camera.id;
  }

  private getMobileBattleCameraView(
    viewport: Phaser.Geom.Rectangle | { width: number; height: number },
    gridBounds: { x: number; y: number; width: number; height: number },
  ): BattleCameraView {
    const rowCount = PositionManager.Instance.getRowCount();
    const rowTuning = this.getMobileCameraRowTuning(rowCount);
    const topCrop = BATTLE_GRID_CELL_HEIGHT * rowTuning.topCropRows;
    const bottomOverscanRatio = Math.max(
      MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO,
      rowTuning.bottomOverscanRows,
    );
    const bottomOverscan = BATTLE_GRID_CELL_HEIGHT * bottomOverscanRatio;
    const targetHeight = gridBounds.height - topCrop + bottomOverscan;
    const verticalZoom = viewport.height / targetHeight * rowTuning.zoomScale;
    const worldViewX = gridBounds.x
      - BATTLE_GRID_CELL_WIDTH * MOBILE_BATTLE_LEFT_CART_OVERSCAN_COLS;
    const worldViewRight = gridBounds.x
      + gridBounds.width
      + BATTLE_GRID_CELL_WIDTH * MOBILE_BATTLE_RIGHT_OVERSCAN_COLS;
    const targetWorldWidth = Math.max(1, worldViewRight - worldViewX);
    const widthZoom = viewport.width / targetWorldWidth;
    const zoom = Math.min(verticalZoom, widthZoom);

    const worldViewY = gridBounds.y + topCrop;
    const scroll = this.getCameraScrollForWorldView(
      worldViewX,
      worldViewY,
      viewport.width,
      viewport.height,
      zoom,
    );

    return { zoom, worldViewX, worldViewY, ...scroll };
  }

  private getMobileCameraRowTuning(rowCount: number): {
    topCropRows: number;
    bottomOverscanRows: number;
    zoomScale: number;
    horizontalShiftCols: number;
  } {
    if (rowCount >= 5) {
      // Negative crop keeps the top minecart above row 0 fully visible.
      return { topCropRows: -0.15, bottomOverscanRows: 0.1, zoomScale: 1, horizontalShiftCols: 0 };
    }
    return { topCropRows: -0.5, bottomOverscanRows: 0.5, zoomScale: 0.95, horizontalShiftCols: 0 };
  }

  private getDesktopBattleCameraView(
    viewport: Phaser.Geom.Rectangle | { width: number; height: number },
  ): BattleCameraView {
    const zoom = Math.max(
      viewport.width / LOGICAL_BATTLE_WIDTH,
      viewport.height / LOGICAL_BATTLE_HEIGHT,
    );
    const visibleWidth = viewport.width / zoom;
    const visibleHeight = viewport.height / zoom;
    const worldViewX = (LOGICAL_BATTLE_WIDTH - visibleWidth) / 2;
    const worldViewY = (LOGICAL_BATTLE_HEIGHT - visibleHeight) / 2;
    const scroll = this.getCameraScrollForWorldView(
      worldViewX,
      worldViewY,
      viewport.width,
      viewport.height,
      zoom,
    );

    return { zoom, worldViewX, worldViewY, ...scroll };
  }

  /**
   * Phaser 的 camera scroll 是中心锚点，而 worldView 描述可见世界左上角。
   * 两者互换，保证 FIT 缩放不会在 UI 旁留下偏心空隙。
   */
  private getCameraScrollForWorldView(
    worldViewX: number,
    worldViewY: number,
    viewportWidth: number,
    viewportHeight: number,
    zoom: number,
  ): { scrollX: number; scrollY: number } {
    return {
      scrollX: worldViewX + (viewportWidth / zoom - viewportWidth) / 2,
      scrollY: worldViewY + (viewportHeight / zoom - viewportHeight) / 2,
    };
  }
}
