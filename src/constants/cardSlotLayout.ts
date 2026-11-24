import type { GameDeviceType } from "./gameLayout";

export const MAX_CARD_SLOTS = 15;
export const MOBILE_CARD_ROWS = 8;
export const MOBILE_HEADER_ROWS = 1;
/**
 * 单列固定行数（表头 + 8 张卡），不随卡组数量变化。
 *
 * 行数一旦跟着卡片数量变，行高就会跟着变：卡少时每张卡被拉高、卡多时又变矮，
 * 而且底部没有占位。固定 9 行后，每行高度恒为「卡片区可用高度 / 9」，
 * 卡片不足 8 张时多出来的行就是占位空白。
 */
export const MOBILE_GRID_ROWS = MOBILE_HEADER_ROWS + MOBILE_CARD_ROWS;
export const MOBILE_PRIMARY_CARD_SLOTS = MOBILE_CARD_ROWS;
export const MOBILE_PRIMARY_COLUMN = 0;
export const MOBILE_EXPANSION_COLUMN = 1;
/** 移动端卡槽列之间的横向间距。 */
export const MOBILE_SLOT_GAP = 4;
/** 移动端同一列内卡槽的上下间距（0 = 上下紧贴，不再留缝）。 */
export const MOBILE_SLOT_ROW_GAP = 0;
export const MOBILE_SLOT_PADDING = 3;

export type SlotFrameKind =
  | "pc-horizontal"
  | "mobile-square";

export type SlotRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  frame: SlotFrameKind;
};

export type SlotPosition = SlotRect & {
  column: number;
  row: number;
  index: number;
};

export type CardSlotArrangement = {
  slots: SlotPosition[];
  rowCount: number;
  columnCount: number;
};

export type CardSlotChromeLayout = {
  energy: SlotRect;
  pickaxe: SlotRect;
  cards: CardSlotArrangement;
};

function clampCardCount(cardCount: number): number {
  if (!Number.isFinite(cardCount)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_CARD_SLOTS, Math.floor(cardCount)));
}

function createSlot(
  x: number,
  y: number,
  width: number,
  height: number,
  frame: SlotFrameKind,
  column: number,
  row: number,
  index: number,
): SlotPosition {
  return { x, y, width, height, frame, column, row, index };
}

export function getPcCardSlotChromeLayout(
  top: { x: number; y: number; width: number; height: number },
  cardCount: number,
): CardSlotChromeLayout {
  const count = clampCardCount(cardCount);
  const gap = Math.max(3, Math.min(6, top.height * 0.05));
  const topCardHeight = Math.max(1, top.height);
  const topCardWidth = topCardHeight * 0.75;
  const cardsX = top.x + topCardWidth + gap;
  const cardStep = topCardWidth + gap;
  const slots: SlotPosition[] = [];

  for (let index = 0; index < count; index += 1) {
    slots.push(createSlot(
      cardsX + index * cardStep,
      top.y,
      topCardWidth,
      topCardHeight,
      "pc-horizontal",
      index,
      0,
      index,
    ));
  }

  return {
    energy: {
      x: top.x,
      y: top.y,
      width: topCardWidth,
      height: topCardHeight,
      frame: "pc-horizontal",
    },
    pickaxe: {
      x: cardsX + count * cardStep,
      y: top.y,
      width: topCardWidth,
      height: topCardHeight,
      frame: "pc-horizontal",
    },
    cards: {
      slots,
      rowCount: 1,
      columnCount: count + 2,
    },
  };
}

/**
 * 移动端卡槽列行数：固定 `MOBILE_GRID_ROWS`。
 *
 * 卡组数量只决定占用前几行，不再压缩行数——行数变了行高就会变，
 * 卡少时卡片会被拉成大方块，且底部不再有占位空白。
 */
export function getMobileCardSlotRows(): number {
  return MOBILE_GRID_ROWS;
}

export function getMobileCardSlotChromeLayout(
  bounds: { x: number; y: number; width: number; height: number },
  cardCount: number,
): CardSlotChromeLayout {
  const count = clampCardCount(cardCount);
  const padding = MOBILE_SLOT_PADDING;
  const gap = MOBILE_SLOT_GAP;
  const rowGap = MOBILE_SLOT_ROW_GAP;
  const laneWidth = Math.max(
    1,
    (bounds.width - padding * 2 - gap) / 2,
  );
  const slotWidth = Math.max(1, Math.floor(laneWidth));
  const rows = getMobileCardSlotRows();
  const headerY = bounds.y + padding;
  const expansionX = bounds.x + padding;
  const primaryX = expansionX + slotWidth + gap;
  const primaryCount = Math.min(MOBILE_PRIMARY_CARD_SLOTS, count);
  const expansionCount = Math.max(0, count - MOBILE_PRIMARY_CARD_SLOTS);

  // 行高按可用高度均分；除不尽的像素逐行 +1，保证最后一行底部正好贴住
  // 卡片区下沿，不会在底部留一条没用上的空白。
  const availableHeight = Math.max(
    rows,
    bounds.height - padding * 2 - (rows - 1) * rowGap,
  );
  const baseHeight = Math.max(1, Math.floor(availableHeight / rows));
  const extraPixels = Math.max(0, Math.floor(availableHeight - baseHeight * rows));
  const rowTops: number[] = [];
  const rowHeights: number[] = [];
  let cursorY = headerY;
  for (let row = 0; row < rows; row += 1) {
    const height = baseHeight + (row < extraPixels ? 1 : 0);
    rowTops.push(cursorY);
    rowHeights.push(height);
    cursorY += height + rowGap;
  }

  const slotHeight = rowHeights[0];
  const slots: SlotPosition[] = [];

  for (let row = 0; row < primaryCount; row += 1) {
    const gridRow = MOBILE_HEADER_ROWS + row;
    slots.push(createSlot(
      primaryX,
      rowTops[gridRow],
      slotWidth,
      rowHeights[gridRow],
      "mobile-square",
      MOBILE_PRIMARY_COLUMN,
      row,
      row,
    ));
  }

  for (let row = 0; row < expansionCount; row += 1) {
    const gridRow = MOBILE_HEADER_ROWS + row;
    slots.push(createSlot(
      expansionX,
      rowTops[gridRow],
      slotWidth,
      rowHeights[gridRow],
      "mobile-square",
      MOBILE_EXPANSION_COLUMN,
      row,
      MOBILE_PRIMARY_CARD_SLOTS + row,
    ));
  }

  slots.sort((left, right) => left.index - right.index);
  return {
    energy: {
      x: expansionX,
      y: headerY,
      width: slotWidth,
      height: slotHeight,
      frame: "mobile-square",
    },
    pickaxe: {
      x: primaryX,
      y: headerY,
      width: slotWidth,
      height: slotHeight,
      frame: "mobile-square",
    },
    cards: {
      slots,
      // 行数固定，未使用的行即占位空白。
      rowCount: MOBILE_CARD_ROWS,
      columnCount: expansionCount > 0 ? 2 : 1,
    },
  };
}

export function getCardSlotArrangement(
  deviceType: GameDeviceType,
  x: number,
  y: number,
  width: number,
  height: number,
  cardCount: number,
): CardSlotArrangement {
  if (deviceType === "mobile") {
    return getMobileCardSlotChromeLayout({ x, y, width, height }, cardCount).cards;
  }
  return getPcCardSlotChromeLayout({ x, y, width, height }, cardCount).cards;
}
