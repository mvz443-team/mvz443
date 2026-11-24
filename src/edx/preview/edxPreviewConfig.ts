import {
  BATTLE_GRID_CELL_HEIGHT,
  BATTLE_GRID_CELL_WIDTH,
} from "../../constants/gameLayout";

/**
 * 图鉴 Phaser 预览的网格与取景参数。
 *
 * 需求：宽 5 格、高 3 行的小场地；器械永远种在中间行的第 2 格（索引 1），
 * 普通僵尸永远出生在最右边的 3 个格（= 最右一列的 3 行）。
 */
export const EDX_PREVIEW_COLS = 5;
export const EDX_PREVIEW_ROWS = 3;

/** 器械固定位置：中间行、从左到右第 2 格。 */
export const EDX_PREVIEW_PLANT_COL = 1;
export const EDX_PREVIEW_PLANT_ROW = Math.floor(EDX_PREVIEW_ROWS / 2);

/** 僵尸出生列：最右一列（该列的 3 行就是“最右边的 3 个格”）。 */
export const EDX_PREVIEW_SPAWN_COL = EDX_PREVIEW_COLS - 1;

/** 器械预览里固定刷新的普通僵尸 mid。 */
export const EDX_PREVIEW_ZOMBIE_MID = 1;

/** 僵尸预览里的沙包器械：南瓜护照（高血量、不还手），用来展示怪物啃咬。 */
export const EDX_PREVIEW_SANDBAG_PID = 19;
export const EDX_PREVIEW_SANDBAG_COL = 0;

/** 画布四周留白（世界坐标像素），让出屏销毁发生在镜头外侧一点。 */
export const EDX_PREVIEW_PADDING = 40;

/** 逻辑画布尺寸：网格尺寸 + 两侧留白。用 CSS 等比缩放到容器宽度。 */
export const EDX_PREVIEW_VIEW_WIDTH = BATTLE_GRID_CELL_WIDTH * EDX_PREVIEW_COLS + EDX_PREVIEW_PADDING * 2;
export const EDX_PREVIEW_VIEW_HEIGHT = BATTLE_GRID_CELL_HEIGHT * EDX_PREVIEW_ROWS + EDX_PREVIEW_PADDING * 2;

/** 预览固定步长，与对战平衡帧一致。 */
export const EDX_PREVIEW_FRAME_INTERVAL_MS = 50;

/** 器械被啃掉后，隔多少逻辑帧重新种下，保证预览无限循环。 */
export const EDX_PREVIEW_PLANT_RESPAWN_FRAMES = 20;

/** 怪物消失后，隔多少逻辑帧在最右格重新出生。 */
export const EDX_PREVIEW_MONSTER_RESPAWN_FRAMES = 10;

/** React 与 Phaser 之间传递当前选择的 registry key。 */
export const EDX_PREVIEW_SELECTION_KEY = "edxSelection";

export type EdxPreviewMode = "plant" | "monster";

/** 预览选择：器械图鉴用 pid/level，僵尸图鉴用 mid。 */
export interface EdxPreviewSelection {
  mode: EdxPreviewMode;
  /** 器械 pid（mode = plant）。 */
  pid?: number;
  /** 器械等级（mode = plant）。 */
  level?: number;
  /** 怪物 mid（mode = monster）。 */
  mid?: number;
}

/**
 * 是否属于同一条目（只看 mode / pid / mid，不看等级）。
 *
 * 用于区分“换条目”和“换等级”：换条目整场重建，
 * 同一条目换等级只需重种预览格里的器械，保留正在运行的僵尸与循环。
 */
export function isSameSelectionTarget(
  a: EdxPreviewSelection | null,
  b: EdxPreviewSelection | null,
): boolean {
  if (!a || !b) return a === b;
  return a.mode === b.mode && a.pid === b.pid && a.mid === b.mid;
}

/**
 * 是否是完全相同的选择（含等级）。
 *
 * 等级会改变血量、伤害、冷却等数值，且这些数值在实体构造期就固化，
 * 所以等级变化也必须刷新预览（由场景重种该格器械实现）。
 */
export function isSameSelection(
  a: EdxPreviewSelection | null,
  b: EdxPreviewSelection | null,
): boolean {
  if (!isSameSelectionTarget(a, b)) return false;
  if (!a || !b) return true;
  return a.level === b.level;
}
