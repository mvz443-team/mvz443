export const SLOT_STROKE = 2;
/** 正常可用（能量足够且冷却完成）的卡槽底色。 */
export const SLOT_FILL = 0xf6f6f6;
/**
 * 能量足够但仍在冷却：灰色底。
 * 比可用态深，但比冷却遮罩（`0x111111` @ 0.62 叠在底色上）浅，
 * 保证遮罩扫过时仍能看出更暗的一段。
 */
export const SLOT_FILL_COOLING = 0xb8b8b8;
/** 冷却遮罩透明度；能量是否足够不改变遮罩强度。 */
export const SLOT_MASK_ALPHA = 0.62;
export const SLOT_BORDER = 0x333333;
export const SLOT_BORDER_CHOSEN = 0xffee22;

export function slotRadius(width: number, height: number): number {
  return Math.min(7, width * 0.16, height * 0.16);
}

export function redrawSlotFrame(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  fillColor = SLOT_FILL,
  lineColor = SLOT_BORDER,
  lineWidth = SLOT_STROKE,
  /** 覆盖默认圆角（移动端卡槽上下紧贴时用更小的圆角，避免贴合处露出月牙缝）。 */
  radiusOverride?: number,
) {
  const radius = radiusOverride ?? slotRadius(width, height);
  graphics.clear();
  graphics.fillStyle(fillColor, 1);
  graphics.fillRoundedRect(0, 0, width, height, radius);
  graphics.lineStyle(lineWidth, lineColor, 1);
  graphics.strokeRoundedRect(0, 0, width, height, radius);
}

export function drawSlotSelectionOutline(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  color = SLOT_BORDER_CHOSEN,
  /** 覆盖默认圆角，必须与 `redrawSlotFrame` 保持一致。 */
  radiusOverride?: number,
) {
  const radius = radiusOverride ?? slotRadius(width, height);
  graphics.clear();
  graphics.lineStyle(
    Math.max(3, Math.min(5, width * 0.07)),
    color,
    1,
  );
  graphics.strokeRoundedRect(
    -2,
    -2,
    width + 4,
    height + 4,
    radius + 2,
  );
}
