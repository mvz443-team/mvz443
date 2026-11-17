import type { GameDeviceType } from "./gameLayout";

export const MAX_CARD_SLOTS = 15;
export const MOBILE_CARD_ROWS = 8;
export const MOBILE_HEADER_ROWS = 1;
export const MOBILE_GRID_ROWS = MOBILE_HEADER_ROWS + MOBILE_CARD_ROWS;
export const MOBILE_PRIMARY_CARD_SLOTS = MOBILE_CARD_ROWS;
export const MOBILE_PRIMARY_COLUMN = 0;
export const MOBILE_EXPANSION_COLUMN = 1;
export const MOBILE_SLOT_GAP = 4;
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

export function getMobileCardSlotChromeLayout(
  bounds: { x: number; y: number; width: number; height: number },
  cardCount: number,
): CardSlotChromeLayout {
  const count = clampCardCount(cardCount);
  const padding = MOBILE_SLOT_PADDING;
  const gap = MOBILE_SLOT_GAP;
  const laneWidth = Math.max(
    1,
    (bounds.width - padding * 2 - gap) / 2,
  );
  const slotHeight = Math.max(
    1,
    Math.floor(
      (bounds.height - padding * 2 - (MOBILE_GRID_ROWS - 1) * gap)
      / MOBILE_GRID_ROWS,
    ),
  );
  const slotWidth = Math.max(1, Math.floor(laneWidth));
  const expansionX = bounds.x + padding;
  const primaryX = expansionX + slotWidth + gap;
  const headerY = bounds.y + padding;
  const cardsTop = headerY + slotHeight + gap;
  const primaryCount = Math.min(MOBILE_PRIMARY_CARD_SLOTS, count);
  const expansionCount = Math.max(0, count - MOBILE_PRIMARY_CARD_SLOTS);
  const slots: SlotPosition[] = [];

  for (let row = 0; row < primaryCount; row += 1) {
    slots.push(createSlot(
      primaryX,
      cardsTop + row * (slotHeight + gap),
      slotWidth,
      slotHeight,
      "mobile-square",
      MOBILE_PRIMARY_COLUMN,
      row,
      row,
    ));
  }

  for (let row = 0; row < expansionCount; row += 1) {
    slots.push(createSlot(
      expansionX,
      cardsTop + row * (slotHeight + gap),
      slotWidth,
      slotHeight,
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
      rowCount: Math.max(1, primaryCount, expansionCount),
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
