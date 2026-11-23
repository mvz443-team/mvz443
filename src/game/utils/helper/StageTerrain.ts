/**
 * 关卡地形的唯一数据源（纯函数、零依赖）。
 *
 * 移除旧的 `stageScript.waterWays` 链路后，所有"水路"相关行为都从这里推导：
 * - `getInitialWaterRows(stageId)`：第 0 波开局初始化后真实被设为 water 的行，
 *   同时供 PresetEventManager 设置 GridManager、图鉴地图预览展示使用；
 * - `getEarlySpawnRows(stageId, rowCount)`：前 3 波允许刷怪的行（白名单）；
 * - `getEarlyWaterwayExceptLine(...)`：白名单的反面，作为 wave.exceptLine。
 *
 * 按 stageID 静态推导而不读运行时 GridManager，是为了避开时序陷阱：
 * generateStageScript() 运行时水面格尚未设置（见 MobManager.handleRoomGameStart
 * → PresetEventManager.triggerCombatStartEvent 的顺序），而图鉴页面根本没有游戏场景。
 * 关卡脚本不会在局中动态改变地形，因此"依赖第 0 波初始化后的情形"等价于这张静态表。
 */

/** 前 EARLY_WATERWAY_SAFE_WAVES 波应用 early-spawn 白名单。 */
export const EARLY_WATERWAY_SAFE_WAVES = 3;

/**
 * 开局真实水面行。当前只有 stage 5 / 8 的水关把 row 2、3 设为 water
 * （对应 PresetEventManager 中 setSingleGridProperty 的调用）。
 */
export function getInitialWaterRows(stageId: number): readonly number[] {
  return stageId === 5 || stageId === 8 ? [2, 3] : [];
}

/**
 * 前 3 波允许刷怪的行；取值为旧 waterWays（被排除的水路行）的反面，
 * 以正向白名单表达。其余关卡返回全部行，等价于旧逻辑的"不排除任何行"。
 */
const EARLY_SPAWN_ROWS: Record<number, readonly number[]> = {
  1: [0, 4],       // 5 行，旧 waterWays=[1,2,3]
  5: [0, 1, 4, 5], // 6 行，旧 waterWays=[2,3]
  7: [0],          // 4 行，旧 waterWays=[1,2,3]
  8: [0, 1, 4, 5], // 6 行，旧 waterWays=[2,3]
};

export function getEarlySpawnRows(stageId: number, rowCount: number): number[] {
  const configured = EARLY_SPAWN_ROWS[stageId];
  if (configured) return configured.filter((row) => row >= 0 && row < rowCount);
  return Array.from({ length: Math.max(0, rowCount) }, (_, row) => row);
}

/** 前 3 波的排除行 = 所有行 - 允许行；其余波次返回空。 */
export function getEarlyWaterwayExceptLine(stageId: number, waveId: number, rowCount: number): number[] {
  if (waveId > EARLY_WATERWAY_SAFE_WAVES) return [];
  const allowed = new Set(getEarlySpawnRows(stageId, rowCount));
  return Array.from({ length: Math.max(0, rowCount) }, (_, row) => row)
    .filter((row) => !allowed.has(row));
}
