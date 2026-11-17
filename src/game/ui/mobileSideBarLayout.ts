import { PositionManager } from "../managers/view/PositionManager";
import type { Rect } from "../../constants/gameLayout";
import {
  MOBILE_GRID_ROWS,
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

export function getMobileSideBarLayout(): MobileSideBarLayout {
  const chrome = PositionManager.Instance.getSceneChromeLayout("mobile");
  const bounds = rect(
    0,
    chrome.mainViewport.y,
    chrome.mobileBottomToolbarWidth + chrome.leftCardSlotWidth,
    chrome.mainTotalHeight,
  );
  const padding = MOBILE_SLOT_PADDING;
  const laneGap = MOBILE_SLOT_GAP;
  const cardHeight = Math.max(1, bounds.height - STATUS_HEIGHT);
  const laneWidth = Math.max(
    1,
    (bounds.width - padding * 2 - laneGap) / 2,
  );
  const slotHeight = Math.max(
    1,
    Math.floor(
      (cardHeight - padding * 2 - (MOBILE_GRID_ROWS - 1) * laneGap)
      / MOBILE_GRID_ROWS,
    ),
  );
  const slotWidth = Math.max(1, Math.floor(laneWidth));

  return {
    bounds,
    cardSection: rect(0, 0, bounds.width, cardHeight),
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
    slotWidth,
    slotHeight,
  };
}
