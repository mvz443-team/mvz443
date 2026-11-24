export const SLOT_STROKE = 2;
export const SLOT_FILL = 0xf6f6f6;
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
