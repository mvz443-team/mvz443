import { PositionManager } from "../managers/view/PositionManager";
import type { Rect } from "../../constants/gameLayout";

export type MobileSideBarLayout = {
  bounds: Rect;
  cardSection: Rect;
  progressSection: Rect;
  actionSection: Rect;
  laneWidth: number;
  laneGap: number;
  padding: number;
  progressBarHeight: number;
};

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
  const padding = Math.max(3, Math.round(bounds.width * 0.035));
  const laneGap = Math.max(3, Math.round(bounds.width * 0.025));
  const oldProgressHeight = Math.max(32, Math.min(56, bounds.height * 0.12));
  const progressBarHeight = Math.max(8, oldProgressHeight * 0.34);
  const progressHeight = Math.max(progressBarHeight + 10, Math.min(40, progressBarHeight + 14));
  const actionHeight = Math.max(36, Math.min(48, bounds.height * 0.08));
  const cardHeight = Math.max(72, bounds.height - progressHeight - actionHeight);
  const laneWidth = (bounds.width - padding * 2 - laneGap * 2) / 3;

  return {
    bounds,
    cardSection: rect(0, 0, bounds.width, cardHeight),
    progressSection: rect(0, cardHeight, bounds.width, progressHeight),
    actionSection: rect(0, cardHeight + progressHeight, bounds.width, bounds.height - cardHeight - progressHeight),
    laneWidth,
    laneGap,
    padding,
    progressBarHeight,
  };
}
