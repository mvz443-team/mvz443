import { PositionManager } from "../managers/view/PositionManager";
import type { GameSceneChromeLayout, Rect } from "../../constants/gameLayout";
import { MOBILE_SIDE_BAR_RIGHT_EXTEND_RATIO } from "../../constants/gameLayout";
import { getMobileBattleLeftGap } from "../scenes/view/mobileBattleCameraView";
import {
  getMobileCardSlotChromeLayout,
  MOBILE_PRIMARY_CARD_SLOTS,
  MOBILE_SLOT_GAP,
  MOBILE_SLOT_PADDING,
} from "../../constants/cardSlotLayout";

export type MobileSideBarLayout = {
  bounds: Rect;
  cardSection: Rect;
  progressSection: Rect;
  actionSection: Rect;
  laneWidth: number;
  laneGap: number;
  padding: number;
  progressBarHeight: number;
  slotWidth: number;
  slotHeight: number;
};

const PROGRESS_HEIGHT = 12;
const ACTION_HEIGHT = 30;
const STATUS_HEIGHT = PROGRESS_HEIGHT + ACTION_HEIGHT;

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/**
 * 侧边栏实际占用的矩形：在原有三列宽度基础上，向右吃掉战斗画面左侧那段
 * 只有背景的空白（见 `MOBILE_SIDE_BAR_RIGHT_EXTEND_RATIO`，默认停在矿车左侧）。
 *
 * 只改渲染宽度，战斗摄像机视口与网格坐标保持不变，因此延伸出来的部分会盖在
 * 战斗画面之上；卡槽、能量、进度条等组件都按这个宽度响应式重算。
 */
function getMobileSideBarBounds(chrome: GameSceneChromeLayout): Rect {
  const baseWidth = chrome.mobileBottomToolbarWidth + chrome.leftCardSlotWidth;
  const gridBounds = PositionManager.Instance.getGridBounds();
  const leftGap = getMobileBattleLeftGap(
    chrome.mainViewport,
    gridBounds,
    PositionManager.Instance.getRowCount(),
  );
  const ratio = Math.min(1, Math.max(0, MOBILE_SIDE_BAR_RIGHT_EXTEND_RATIO));
  // 向上取整，避免亚像素缝隙在面板与网格之间留下一条背景色细线。
  const width = Math.ceil(baseWidth + leftGap * ratio);
  const maxWidth = Math.max(baseWidth, chrome.sceneBounds.width);

  return rect(
    0,
    chrome.mainViewport.y,
    Math.min(maxWidth, width),
    chrome.mainTotalHeight,
  );
}

/**
 * 移动端侧边栏布局。
 *
 * `slotWidth` / `slotHeight` 直接取自卡槽排布（行数随卡组数量自适应），
 * 避免这里和 `getMobileCardSlotChromeLayout` 各算一份、卡少时对不上。
 */
export function getMobileSideBarLayout(
  cardCount: number = MOBILE_PRIMARY_CARD_SLOTS,
): MobileSideBarLayout {
  const chrome = PositionManager.Instance.getSceneChromeLayout("mobile");
  const bounds = getMobileSideBarBounds(chrome);
  const padding = MOBILE_SLOT_PADDING;
  const laneGap = MOBILE_SLOT_GAP;
  const cardHeight = Math.max(1, bounds.height - STATUS_HEIGHT);
  const cardSection = rect(0, 0, bounds.width, cardHeight);
  const slotLayout = getMobileCardSlotChromeLayout(
    {
      x: bounds.x,
      y: bounds.y + cardSection.y,
      width: cardSection.width,
      height: cardSection.height,
    },
    cardCount,
  );
  const laneWidth = Math.max(
    1,
    (bounds.width - padding * 2 - laneGap) / 2,
  );

  return {
    bounds,
    cardSection,
    progressSection: rect(0, cardHeight, bounds.width, PROGRESS_HEIGHT),
    actionSection: rect(
      0,
      cardHeight + PROGRESS_HEIGHT,
      bounds.width,
      ACTION_HEIGHT,
    ),
    laneWidth,
    laneGap,
    padding,
    progressBarHeight: 8,
    slotWidth: slotLayout.energy.width,
    slotHeight: slotLayout.energy.height,
  };
}
