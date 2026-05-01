export const LOGICAL_GAME_WIDTH = 800;
export const LOGICAL_GAME_HEIGHT = 600;
export const GAME_ASPECT_RATIO = LOGICAL_GAME_HEIGHT / LOGICAL_GAME_WIDTH;
export const GAME_SIDE_TOOL_GAP = 10;

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
  sideCardSlotWidth: number;
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
  leftCardSlot: Rect;
  rightCardSlot: Rect;
};

export function getBottomToolbarHeight(mainWidth: number, showGameTool = true): number {
  return showGameTool ? mainWidth / 32 : 0;
}

export function getTopCardSlotHeight(
  mainWidth: number,
  deviceType: GameDeviceType,
  showGameTool = true,
): number {
  return showGameTool && deviceType === 'pc' ? Math.min(mainWidth / 8, 135) : 0;
}

export function getSideCardSlotWidth(mainWidth: number, showGameTool = true): number {
  return showGameTool ? Math.min(mainWidth / 7, 135) : 0;
}

export function getGameToolLayoutMetrics(
  mainWidth: number,
  mainHeight: number,
  deviceType: GameDeviceType,
  showGameTool = true,
): GameToolLayoutMetrics {
  const bottomToolbarHeight = getBottomToolbarHeight(mainWidth, showGameTool);
  const topCardSlotHeight = getTopCardSlotHeight(mainWidth, deviceType, showGameTool);
  const sideCardSlotWidth = getSideCardSlotWidth(mainWidth, showGameTool);
  const sideToolGap = showGameTool ? GAME_SIDE_TOOL_GAP : 0;
  const leftCardSlotWidth = showGameTool && deviceType === 'mobile' ? sideCardSlotWidth : 0;
  const rightCardSlotWidth = showGameTool ? sideCardSlotWidth : 0;
  const leftToolOuterWidth = leftCardSlotWidth > 0 ? leftCardSlotWidth + sideToolGap : 0;
  const rightToolOuterWidth = rightCardSlotWidth > 0 ? rightCardSlotWidth + sideToolGap : 0;
  const mainTotalHeight = mainHeight + bottomToolbarHeight;
  const rightCardSlotHeight = showGameTool
    ? mainTotalHeight + topCardSlotHeight
    : 0;

  return {
    mainWidth,
    mainHeight,
    mainTotalHeight,
    topCardSlotHeight,
    bottomToolbarHeight,
    sideCardSlotWidth,
    sideToolGap,
    leftCardSlotWidth,
    rightCardSlotWidth,
    leftToolOuterWidth,
    rightToolOuterWidth,
    rightCardSlotHeight,
    totalWidth: mainWidth + leftToolOuterWidth + rightToolOuterWidth,
    totalHeight: mainHeight + bottomToolbarHeight + topCardSlotHeight,
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
      y: mainViewport.y + mainHeight,
      width: mainWidth,
      height: metrics.bottomToolbarHeight,
    },
    leftCardSlot: {
      x: 0,
      y: mainViewport.y,
      width: metrics.leftCardSlotWidth,
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
