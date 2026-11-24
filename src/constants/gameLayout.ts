export const LOGICAL_BATTLE_WORLD_WIDTH = 800;
export const BATTLE_GRID_COLS = 9;
export const BATTLE_GRID_MAX_ROWS = 7;
export const BATTLE_GRID_CELL_WIDTH = 80;
export const BATTLE_GRID_CELL_HEIGHT = 90;
export const BATTLE_GRID_BASE_OFFSET_X = 50;
export const BATTLE_GRID_LEFT_CART_MARGIN_RATIO = 0.4;
export const BATTLE_GRID_OFFSET_X =
  BATTLE_GRID_BASE_OFFSET_X
  + BATTLE_GRID_CELL_WIDTH * BATTLE_GRID_LEFT_CART_MARGIN_RATIO;
export const BATTLE_GRID_OFFSET_Y_FOR_MAX_ROWS = 20;
export const BATTLE_GRID_BOTTOM_MARGIN_FOR_MAX_ROWS = 40;
export const GAME_SIDE_TOOL_GAP = 10;
export const LOGICAL_BATTLE_HEIGHT =
  BATTLE_GRID_OFFSET_Y_FOR_MAX_ROWS
  + BATTLE_GRID_MAX_ROWS * BATTLE_GRID_CELL_HEIGHT
  + BATTLE_GRID_BOTTOM_MARGIN_FOR_MAX_ROWS;
export const PC_GAME_SCENE_TARGET_ASPECT_RATIO = 16 / 9;
export const PC_TOP_CARD_SLOT_HEIGHT = LOGICAL_BATTLE_WORLD_WIDTH / 8;
export const PC_SIDE_CARD_SLOT_WIDTH = LOGICAL_BATTLE_WORLD_WIDTH / 7;
export const PC_BOTTOM_TOOLBAR_BASE_HEIGHT = LOGICAL_BATTLE_WORLD_WIDTH / 32;
export const PC_BOTTOM_TOOLBAR_OVERLAP_HEIGHT = PC_BOTTOM_TOOLBAR_BASE_HEIGHT * 0.5;
export const PC_BOTTOM_TOOLBAR_HEIGHT = PC_BOTTOM_TOOLBAR_BASE_HEIGHT * 1.5;
export const LOGICAL_BATTLE_WIDTH = Math.round(
  PC_GAME_SCENE_TARGET_ASPECT_RATIO
  * (LOGICAL_BATTLE_HEIGHT + PC_TOP_CARD_SLOT_HEIGHT + PC_BOTTOM_TOOLBAR_BASE_HEIGHT)
  - PC_SIDE_CARD_SLOT_WIDTH
  - GAME_SIDE_TOOL_GAP
);
export const LOGICAL_GAME_WIDTH = LOGICAL_BATTLE_WIDTH;
export const LOGICAL_GAME_HEIGHT = LOGICAL_BATTLE_HEIGHT;
export const GAME_ASPECT_RATIO = LOGICAL_BATTLE_HEIGHT / LOGICAL_BATTLE_WIDTH;
export const PC_TOP_CARD_SLOT_RATIO = PC_TOP_CARD_SLOT_HEIGHT / LOGICAL_BATTLE_HEIGHT;
export const PC_SIDE_CARD_SLOT_RATIO = PC_SIDE_CARD_SLOT_WIDTH / LOGICAL_BATTLE_HEIGHT;
export const PC_BOTTOM_TOOLBAR_OVERLAP_RATIO = PC_BOTTOM_TOOLBAR_OVERLAP_HEIGHT / LOGICAL_BATTLE_HEIGHT;
export const MOBILE_TOOL_WIDTH_RATIO_BY_HEIGHT = 1 / 12;
export const MOBILE_TOOL_MIN_WIDTH = 32;
export const MOBILE_TOOL_MAX_WIDTH = 40;
export const MOBILE_BATTLE_RIGHT_EXTRA_COL_RATIO = 0.25;
export const MOBILE_BATTLE_BOTTOM_OVERSCAN_ROW_RATIO = 0.25;
export const MOBILE_BATTLE_LEFT_CART_OVERSCAN_COLS = 1.7;
export const MOBILE_BATTLE_RIGHT_OVERSCAN_COLS = 0.15;
/**
 * 移动端侧边卡槽栏向右延伸的比例（人工微调入口）。
 *
 * 战斗画面左侧从视口左边缘到网格左边缘之间有一段只有背景、没有网格内容的
 * 空白（世界宽度固定 1.7 格 = 136，屏幕上是战斗视口宽度的 10%~16%）。
 * 该值让卡槽栏吃掉其中一部分，卡槽、能量、星之碎片、进度条、暂停按钮
 * 按新宽度响应式放大。
 *
 * 比例按“这段空白的世界宽度 136”换算：
 * - `0`     保持原布局，空白全部露出；
 * - `0.34`  右边缘停在矿车左侧（默认）。矿车中心在世界 x=26、纹理 64 宽，
 *           占 -6..58；可见左边界是 -54，所以最多只能吃 48 ≈ 136*0.35。
 *           取 0.34 留 1~2px 余量，保证矿车完整可见；
 * - `0.35`  正好贴住矿车左缘；
 * - `1`     贴到网格左边缘（会把整排矿车支架盖掉，不推荐）。
 *
 * 只影响渲染，不改变战斗视口、网格坐标、相机缩放与任何战斗逻辑。
 */
export const MOBILE_SIDE_BAR_RIGHT_EXTEND_RATIO = 0.38;
export const BOTTOM_TOOLBAR_RATIO = PC_BOTTOM_TOOLBAR_HEIGHT / LOGICAL_BATTLE_HEIGHT;

export type GameDeviceType = 'pc' | 'mobile' | string;

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GameToolLayoutMetrics = {
  mainWidth: number;
  mainHeight: number;
  mainTotalHeight: number;
  topCardSlotHeight: number;
  bottomToolbarHeight: number;
  bottomToolbarOverlapHeight: number;
  sideCardSlotWidth: number;
  mobileLeftCardSlotWidth: number;
  mobileRightCardSlotWidth: number;
  mobileBottomToolbarWidth: number;
  sideToolGap: number;
  leftCardSlotWidth: number;
  rightCardSlotWidth: number;
  leftToolOuterWidth: number;
  rightToolOuterWidth: number;
  rightCardSlotHeight: number;
  totalWidth: number;
  totalHeight: number;
};

export type GameSceneChromeLayout = GameToolLayoutMetrics & {
  sceneBounds: Rect;
  mainViewport: Rect;
  topCardSlot: Rect;
  bottomToolbar: Rect;
  mobileBottomToolbar: Rect;
  leftCardSlot: Rect;
  mobileLeftCardSlot: Rect;
  mobileRightCardSlot: Rect;
  rightCardSlot: Rect;
};

export function getBottomToolbarHeight(mainWidth: number, mainHeight: number, showGameTool = true): number {
  void mainWidth;
  return showGameTool ? mainHeight * BOTTOM_TOOLBAR_RATIO : 0;
}

export function getBottomToolbarOverlapHeight(mainWidth: number, mainHeight: number, showGameTool = true): number {
  void mainWidth;
  return showGameTool ? mainHeight * PC_BOTTOM_TOOLBAR_OVERLAP_RATIO : 0;
}

export function getTopCardSlotHeight(
  mainWidth: number,
  mainHeight: number,
  deviceType: GameDeviceType,
  showGameTool = true,
): number {
  void mainWidth;
  return showGameTool && deviceType === 'pc' ? mainHeight * PC_TOP_CARD_SLOT_RATIO : 0;
}

export function getSideCardSlotWidth(mainWidth: number, mainHeight: number, showGameTool = true): number {
  void mainWidth;
  return showGameTool ? mainHeight * PC_SIDE_CARD_SLOT_RATIO : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeBattleGridRows(rows: number | undefined, fallback = BATTLE_GRID_MAX_ROWS): number {
  const value = Number.isFinite(rows) ? Math.floor(rows as number) : fallback;
  return clamp(value, 1, BATTLE_GRID_MAX_ROWS);
}

export function getBattleGridHeightForRows(rows: number | undefined, fallback = BATTLE_GRID_MAX_ROWS): number {
  return normalizeBattleGridRows(rows, fallback) * BATTLE_GRID_CELL_HEIGHT;
}

export function getMobileBattleTargetWorldWidth(): number {
  return BATTLE_GRID_CELL_WIDTH
    * (BATTLE_GRID_COLS + BATTLE_GRID_LEFT_CART_MARGIN_RATIO + MOBILE_BATTLE_RIGHT_EXTRA_COL_RATIO);
}

export function getMobileToolWidth(mainHeight: number, showGameTool = true): number {
  if (!showGameTool) {
    return 0;
  }

  return clamp(
    mainHeight * MOBILE_TOOL_WIDTH_RATIO_BY_HEIGHT,
    MOBILE_TOOL_MIN_WIDTH,
    MOBILE_TOOL_MAX_WIDTH,
  );
}

export function getMobileCardSlotWidth(mainWidth: number, mainHeight: number, showGameTool = true): number {
  void mainWidth;
  return getMobileToolWidth(mainHeight, showGameTool);
}

export function getMobileBottomToolbarWidth(mainWidth: number, mainHeight: number, showGameTool = true): number {
  void mainWidth;
  return getMobileToolWidth(mainHeight, showGameTool);
}

export function getGameToolLayoutMetrics(
  mainWidth: number,
  mainHeight: number,
  deviceType: GameDeviceType,
  showGameTool = true,
): GameToolLayoutMetrics {
  const isMobile = deviceType === 'mobile';
  const bottomToolbarHeight = !isMobile ? getBottomToolbarHeight(mainWidth, mainHeight, showGameTool) : 0;
  const bottomToolbarOverlapHeight = !isMobile
    ? getBottomToolbarOverlapHeight(mainWidth, mainHeight, showGameTool)
    : 0;
  const topCardSlotHeight = getTopCardSlotHeight(mainWidth, mainHeight, deviceType, showGameTool);
  const sideCardSlotWidth = deviceType === 'mobile'
    ? getMobileCardSlotWidth(mainWidth, mainHeight, showGameTool)
    : getSideCardSlotWidth(mainWidth, mainHeight, showGameTool);
  const sideToolGap = showGameTool && !isMobile ? GAME_SIDE_TOOL_GAP : 0;
  const mobileLeftCardSlotWidth = showGameTool && deviceType === 'mobile' ? sideCardSlotWidth : 0;
  const mobileRightCardSlotWidth = showGameTool && deviceType === 'mobile' ? sideCardSlotWidth : 0;
  const mobileBottomToolbarWidth = showGameTool && deviceType === 'mobile'
    ? getMobileBottomToolbarWidth(mainWidth, mainHeight, showGameTool)
    : 0;
  const leftCardSlotWidth = mobileLeftCardSlotWidth + mobileRightCardSlotWidth;
  const rightCardSlotWidth = showGameTool && deviceType === 'pc' ? sideCardSlotWidth : 0;
  const mobileLeftToolWidth = mobileBottomToolbarWidth + leftCardSlotWidth;
  const leftToolOuterWidth = mobileLeftToolWidth > 0 ? mobileLeftToolWidth + sideToolGap : 0;
  const rightToolOuterWidth = rightCardSlotWidth > 0 ? rightCardSlotWidth + sideToolGap : 0;
  const mainTotalHeight = mainHeight + bottomToolbarHeight - bottomToolbarOverlapHeight;
  const rightCardSlotHeight = showGameTool
    ? mainTotalHeight + topCardSlotHeight
    : 0;

  return {
    mainWidth,
    mainHeight,
    mainTotalHeight,
    topCardSlotHeight,
    bottomToolbarHeight,
    bottomToolbarOverlapHeight,
    sideCardSlotWidth,
    mobileLeftCardSlotWidth,
    mobileRightCardSlotWidth,
    mobileBottomToolbarWidth,
    sideToolGap,
    leftCardSlotWidth,
    rightCardSlotWidth,
    leftToolOuterWidth,
    rightToolOuterWidth,
    rightCardSlotHeight,
    totalWidth: mainWidth + leftToolOuterWidth + rightToolOuterWidth,
    totalHeight: mainHeight + bottomToolbarHeight - bottomToolbarOverlapHeight + topCardSlotHeight,
  };
}

export function getGameSceneChromeLayout(
  mainWidth: number,
  mainHeight: number,
  deviceType: GameDeviceType,
  showGameTool = true,
): GameSceneChromeLayout {
  const metrics = getGameToolLayoutMetrics(mainWidth, mainHeight, deviceType, showGameTool);
  const mainViewport: Rect = {
    x: metrics.leftToolOuterWidth,
    y: metrics.topCardSlotHeight,
    width: mainWidth,
    height: mainHeight,
  };
  const sceneWidth = Math.max(1, metrics.totalWidth);
  const sceneHeight = Math.max(1, metrics.totalHeight);
  if (deviceType !== 'mobile') {
    return {
      ...metrics,
      sceneBounds: { x: 0, y: 0, width: sceneWidth, height: sceneHeight },
      mainViewport: { x: 0, y: metrics.topCardSlotHeight, width: sceneWidth, height: mainHeight },
      topCardSlot: { x: 0, y: 0, width: sceneWidth, height: metrics.topCardSlotHeight },
      bottomToolbar: {
        x: 0,
        y: metrics.topCardSlotHeight + mainHeight - metrics.bottomToolbarOverlapHeight,
        width: sceneWidth,
        height: metrics.bottomToolbarHeight,
      },
      mobileBottomToolbar: { x: 0, y: metrics.topCardSlotHeight, width: 0, height: mainHeight },
      leftCardSlot: { x: 0, y: metrics.topCardSlotHeight, width: 0, height: metrics.mainTotalHeight },
      mobileLeftCardSlot: { x: 0, y: metrics.topCardSlotHeight, width: 0, height: metrics.mainTotalHeight },
      mobileRightCardSlot: { x: 0, y: metrics.topCardSlotHeight, width: 0, height: metrics.mainTotalHeight },
      rightCardSlot: {
        x: sceneWidth - metrics.rightCardSlotWidth,
        y: 0,
        width: metrics.rightCardSlotWidth,
        height: metrics.rightCardSlotHeight,
      },
    };
  }

  return {
    ...metrics,
    sceneBounds: {
      x: 0,
      y: 0,
      width: metrics.totalWidth,
      height: metrics.totalHeight,
    },
    mainViewport,
    topCardSlot: {
      x: mainViewport.x,
      y: 0,
      width: mainWidth,
      height: metrics.topCardSlotHeight,
    },
    bottomToolbar: {
      x: mainViewport.x,
      y: mainViewport.y + mainHeight - metrics.bottomToolbarOverlapHeight,
      width: mainWidth,
      height: metrics.bottomToolbarHeight,
    },
    mobileBottomToolbar: {
      x: 0,
      y: mainViewport.y,
      width: metrics.mobileBottomToolbarWidth,
      height: mainHeight,
    },
    leftCardSlot: {
      x: metrics.mobileBottomToolbarWidth,
      y: mainViewport.y,
      width: metrics.leftCardSlotWidth,
      height: metrics.mainTotalHeight,
    },
    mobileLeftCardSlot: {
      x: metrics.mobileBottomToolbarWidth,
      y: mainViewport.y,
      width: metrics.mobileLeftCardSlotWidth,
      height: metrics.mainTotalHeight,
    },
    mobileRightCardSlot: {
      x: metrics.mobileBottomToolbarWidth + metrics.mobileLeftCardSlotWidth,
      y: mainViewport.y,
      width: metrics.mobileRightCardSlotWidth,
      height: metrics.mainTotalHeight,
    },
    rightCardSlot: {
      x: mainViewport.x + mainWidth,
      y: 0,
      width: metrics.rightCardSlotWidth,
      height: metrics.rightCardSlotHeight,
    },
  };
}
