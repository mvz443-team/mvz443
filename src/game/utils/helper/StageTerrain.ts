/**
 * 关卡地形纯函数（零依赖）。
 *
 * 地形不再是"按 stageId 写死的表"，而是由每个关卡的 `LevelScript.terrain`
 * 显式声明，再通过本文件提供的纯函数推导：
 * - `getInitialWaterRows(terrain)`：开局整行设为 water 的行；
 * - `getEarlySpawnRows(terrain, rowCount)`：前 3 波允许刷怪的行（白名单）；
 * - `getEarlyWaterwayExceptLine(terrain, waveId, rowCount)`：白名单的反面，作为 wave.exceptLine。
 *
 * 不读运行时 GridManager，是为了避开时序陷阱：generateStageScript() 运行时水面格尚未设置
 * （见 MobManager.handleRoomGameStart → PresetEventManager.triggerCombatStartEvent 的顺序），
 * 而图鉴页面根本没有游戏场景。
 */

/** 前 EARLY_WATERWAY_SAFE_WAVES 波应用 early-spawn 白名单。 */
export const EARLY_WATERWAY_SAFE_WAVES = 3;

/** 关卡地形声明（由关卡脚本提供）。缺省字段表示"无特殊地形"。 */
export interface StageTerrainConfig {
  /** 开局整行设为 water 的行（0-based）。 */
  initialWaterRows?: readonly number[];
  /** 前 3 波允许刷怪的行白名单（0-based）。缺省表示允许全部行。 */
  earlySpawnRows?: readonly number[];
}

/** 开局真实水面行。 */
export function getInitialWaterRows(terrain: StageTerrainConfig | undefined): readonly number[] {
  return terrain?.initialWaterRows ?? [];
}

/** 前 3 波允许刷怪的行；越界行被裁剪。 */
export function getEarlySpawnRows(terrain: StageTerrainConfig | undefined, rowCount: number): number[] {
  const configured = terrain?.earlySpawnRows;
  if (configured) return configured.filter((row) => row >= 0 && row < rowCount);
  return Array.from({ length: Math.max(0, rowCount) }, (_, row) => row);
}

/** 前 3 波的排除行 = 所有行 - 允许行；其余波次返回空。 */
export function getEarlyWaterwayExceptLine(
  terrain: StageTerrainConfig | undefined,
  waveId: number,
  rowCount: number,
): number[] {
  if (waveId > EARLY_WATERWAY_SAFE_WAVES) return [];
  const allowed = new Set(getEarlySpawnRows(terrain, rowCount));
  return Array.from({ length: Math.max(0, rowCount) }, (_, row) => row)
    .filter((row) => !allowed.has(row));
}
