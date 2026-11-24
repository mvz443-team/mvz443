/**
 * 移动端战斗摄像机的可见世界区域（纯几何，无 Phaser 依赖）。
 *
 * 两个消费方必须共用同一份公式：
 * - `BattleViewLayers`：摆放战斗摄像机；
 * - `ui/mobileSideBarLayout`：算出“网格左边缘到视口左边缘”的空白宽度，
 *   让卡槽栏向右延伸时正好吃满这段空白。
 *
 * 只影响渲染，不参与任何战斗逻辑。
 */
import {
  BATTLE_GRID_CELL_HEIGHT,
  BATTLE_GRID_CELL_WIDTH,
  MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO,
  MOBILE_BATTLE_LEFT_CART_OVERSCAN_COLS,
  MOBILE_BATTLE_RIGHT_OVERSCAN_COLS,
} from "../../../constants/gameLayout";

export type MobileBattleWorldView = {
  zoom: number;
  /** 可见世界左上角（战斗摄像机视口左上角对应的世界坐标）。 */
  worldViewX: number;
  worldViewY: number;
};

type ViewportSize = { width: number; height: number };
type GridBounds = { x: number; y: number; width: number; height: number };

type MobileCameraRowTuning = {
  topCropRows: number;
  bottomOverscanRows: number;
  zoomScale: number;
};

function getMobileCameraRowTuning(rowCount: number): MobileCameraRowTuning {
  if (rowCount >= 5) {
    // 负的裁剪值让第 0 行上方的矿车也能完整显示。
    return { topCropRows: -0.15, bottomOverscanRows: 0.1, zoomScale: 1 };
  }
  return { topCropRows: -0.5, bottomOverscanRows: 0.5, zoomScale: 0.95 };
}

export function getMobileBattleWorldView(
  viewport: ViewportSize,
  gridBounds: GridBounds,
  rowCount: number,
): MobileBattleWorldView {
  const rowTuning = getMobileCameraRowTuning(rowCount);
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

  return {
    zoom: Math.min(verticalZoom, widthZoom),
    worldViewX,
    worldViewY: gridBounds.y + topCrop,
  };
}

/**
 * 战斗视口左边缘到网格左边缘的屏幕像素宽度，也就是卡槽栏右侧那段
 * 只有背景、没有网格内容的空白（矿车车道 + 空草地）。
 */
export function getMobileBattleLeftGap(
  viewport: ViewportSize,
  gridBounds: GridBounds,
  rowCount: number,
): number {
  const view = getMobileBattleWorldView(viewport, gridBounds, rowCount);
  return Math.max(0, (gridBounds.x - view.worldViewX) * view.zoom);
}
