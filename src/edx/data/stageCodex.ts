import { ChapterLibrary, StageDataRecords } from "../../game/managers/library/ChapterLibrary";
import { BATTLE_GRID_COLS } from "../../constants/gameLayout";
import { publicUrl } from "../../utils/browser";
import type { StageData } from "../../types/stage";

export interface StageCodexEntry {
  stageId: number;
  chapterId: number;
  nameKey: string;
  descriptionKey: string;
  /** 行数来自关卡配置。 */
  rows: number;
  /** 列数：战斗网格固定 9 列，关卡配置里没有列字段。 */
  cols: number;
  /** 水路行号（0 基），来自 `stageScript.waterWays`。 */
  waterWays: number[];
  energy: number;
  totalWaves: number;
  /** 1 = 白天，2 = 夜晚（见关卡配置 dayOrNight）。 */
  dayOrNight: number;
}

/**
 * 地图图鉴的数据来源。
 *
 * 格子数量、水路、初始能量、波次总数全部从 `public/stages/**` 的关卡配置读取，
 * 不在 UI 里写死；配置缺失时按空数据降级，不影响其它图鉴页面。
 */
let cache: Promise<StageCodexEntry[]> | null = null;

export function loadStageCodexEntries(): Promise<StageCodexEntry[]> {
  if (!cache) {
    cache = fetchStageCodexEntries();
  }
  return cache;
}

/** 关掉图鉴后释放缓存，方便改关卡配置后重新读取。 */
export function clearStageCodexCache(): void {
  cache = null;
}

async function fetchStageCodexEntries(): Promise<StageCodexEntry[]> {
  await ChapterLibrary.Initialize();
  const stageIds = Object.keys(StageDataRecords)
    .map((key) => Number(key))
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b);

  const entries = await Promise.all(stageIds.map((stageId) => fetchSingleStage(stageId)));
  return entries
    .filter((entry): entry is StageCodexEntry => entry !== null)
    .sort((a, b) => (a.chapterId - b.chapterId) || (a.stageId - b.stageId));
}

async function fetchSingleStage(stageId: number): Promise<StageCodexEntry | null> {
  const record = StageDataRecords[stageId];
  if (!record) return null;
  try {
    const response = await fetch(`${publicUrl}/${record.dataPath}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json() as StageData;
    return {
      stageId,
      chapterId: data.chapterId ?? record.chapterId,
      nameKey: data.nameKey ?? record.nameKey,
      descriptionKey: data.descriptionKey ?? record.descriptionKey,
      rows: Number(data.rows) > 0 ? Number(data.rows) : 0,
      cols: BATTLE_GRID_COLS,
      waterWays: normalizeWaterWays(data.stageScript?.waterWays, Number(data.rows)),
      energy: Number(data.energy) || 0,
      totalWaves: Number(data.stageScript?.total_waves) || 0,
      dayOrNight: Number(data.stageScript?.dayOrNight) || 0,
    };
  } catch (error) {
    console.warn(`[EdxStageCodex] 无法读取关卡 ${stageId} 的配置`, error);
    return {
      stageId,
      chapterId: record.chapterId,
      nameKey: record.nameKey,
      descriptionKey: record.descriptionKey,
      rows: 0,
      cols: BATTLE_GRID_COLS,
      waterWays: [],
      energy: 0,
      totalWaves: 0,
      dayOrNight: 0,
    };
  }
}

/** 水路行号去重、排序并裁剪到合法行范围。 */
function normalizeWaterWays(waterWays: number[] | undefined, rows: number): number[] {
  if (!Array.isArray(waterWays)) return [];
  const maxRow = rows > 0 ? rows - 1 : Number.POSITIVE_INFINITY;
  return [...new Set(
    waterWays
      .map((row) => Number(row))
      .filter((row) => Number.isInteger(row) && row >= 0 && row <= maxRow),
  )].sort((a, b) => a - b);
}
