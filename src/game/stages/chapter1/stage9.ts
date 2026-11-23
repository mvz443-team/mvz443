import type { StageData } from "../../../types/stage";
import type { GridCell, LevelScript, StageModule } from "../types";
import { CHAPTER1_STAGES } from "./metadata.ts";

const metadata = CHAPTER1_STAGES.find((s) => s.levelId === 9)!;

/** 触发地图崩塌的波次。 */
export const STAGE9_COLLAPSE_WAVE = 22;
/** 触发取消地图光照的波次。 */
export const STAGE9_LIGHTS_OUT_WAVE = 36;
/** 光照取消前的闪烁次数。 */
export const STAGE9_LIGHT_FLICKER_COUNT = 3;

/** 1-based 行/列（需求描述）→ 0-based。 */
const COLLAPSE_ROWS_1BASED = [2, 3, 5, 6] as const;
const COLLAPSE_COLS_1BASED = [3, 4, 6, 7, 8] as const;

/** 第 22 波崩塌成水路的格子（0-based，确定性顺序）。 */
export const STAGE9_COLLAPSE_CELLS: readonly GridCell[] = (() => {
  const cells: GridCell[] = [];
  for (const row of COLLAPSE_ROWS_1BASED) {
    for (const col of COLLAPSE_COLS_1BASED) {
      cells.push({ col: col - 1, row: row - 1 });
    }
  }
  return cells;
})();

const content: StageData = {
  ...metadata,
  levelIntro: [{ type: "text", content: "sg9" }],
  rows: 7,
  type: 1,
  stageScript: {
    first_wave_id: 0,
    total_waves: 52,
    base_difficulty: 0,
    difficulty_limit: 56,
    phase1_end: 11,
    phase2_end: 28,
    dayOrNight: 1,
    flagWaves: [10, 20, 30, 40, 50],
    AllowedMobs: [1, 2, 3, 8, 5, 7, 9, 11, 14, 15, 16],
    globalRatio: [[0, 1], [21, 2], [35, 3]],
    bossInsert: [[32, 12], [42, 13], [51, 17]],
  },
  onWin: {
    unLock: [],
    unLockPlant: [],
  },
  energy: 100,
  rewards: [
    { progress: 75, reward: { id: 1, number: 120 } },
    { progress: 90, reward: { id: 2, number: 3 } },
    { progress: 90, reward: { id: 3, number: 3 } },
    { progress: 100, reward: { id: 1, number: 200 } },
    { progress: 100, reward: { id: 5, number: 3 } },
  ],
  load: {
    bgimg: ["bg/bgDeepMine.png"],
    bgm: ["audio/OLJA-0021-08.ogg", "audio/ZCDS-0014-05.ogg"],
  },
};

const script: LevelScript = {
  id: "ch1_stage9",
  onCombatStart(ctx) {
    // 蜈蚣 BOSS 出场时停自动产能并压暗画面。
    ctx.registerBossHooks({
      onSpawn: () => {
        ctx.stopAutoEnergy();
        ctx.addDarkOverlay(0.5);
      },
    });
  },
  onWaveStart(ctx, waveId) {
    if (waveId === STAGE9_COLLAPSE_WAVE && !ctx.getFlag("collapse")) {
      ctx.setFlag("collapse", true);
      for (const cell of STAGE9_COLLAPSE_CELLS) ctx.setCellWater(cell.col, cell.row);
      ctx.playCollapseVisual(STAGE9_COLLAPSE_CELLS);
    }
    if (waveId === STAGE9_LIGHTS_OUT_WAVE && !ctx.getFlag("lightsOut")) {
      ctx.setFlag("lightsOut", true);
      ctx.setDayOrNight(false);
      ctx.stopAutoEnergy();
      ctx.playLightFlicker(STAGE9_LIGHT_FLICKER_COUNT);
    }
  },
  syncView(ctx) {
    // 从快照标记重建水面覆盖层；回滚到崩塌前会自动回收。
    ctx.syncWaterTiles(STAGE9_COLLAPSE_CELLS, ctx.getFlag("collapse"));
  },
};

const stage9: StageModule = { metadata, content, script };
export default stage9;
