import type { StageData } from "../../../types/stage";
import type { LevelScript, StageModule } from "../types";
import { PLANT_PIDS } from "../../presets/plant/pids.ts";
import { CHAPTER1_STAGES } from "./metadata.ts";

const metadata = CHAPTER1_STAGES.find((s) => s.levelId === 8)!;

const content: StageData = {
  ...metadata,
  levelIntro: [
    { type: "img", src: "img/sg8.png" },
    { type: "text", content: "sg8" },
  ],
  rows: 6,
  type: 1,
  stageScript: {
    first_wave_id: 0,
    total_waves: 32,
    base_difficulty: 0,
    difficulty_limit: 60,
    phase1_end: 11,
    phase2_end: 22,
    dayOrNight: 2,
    flagWaves: [10, 20, 30],
    AllowedMobs: [1, 2, 3, 8, 5, 7, 9, 11, 14, 15, 16, 27],
    globalRatio: [[0, 1], [21, 2]],
    bossInsert: [[31, 13]],
  },
  onWin: {
    unLock: [],
    unLockPlant: [13],
  },
  energy: 100,
  rewards: [
    { progress: 75, reward: { id: 1, number: 110 } },
    { progress: 90, reward: { id: 2, number: 2 } },
    { progress: 90, reward: { id: 3, number: 3 } },
    { progress: 100, reward: { id: 1, number: 160 } },
    { progress: 100, reward: { id: 5, number: 2 } },
  ],
  load: {
    bgimg: ["bg/bgDeepMineWater.png"],
    bgm: ["audio/OLJA-0021-08.ogg", "audio/ZCDS-0014-05.ogg"],
  },
};

const script: LevelScript = {
  id: "ch1_stage8",
  terrain: { initialWaterRows: [2, 3], earlySpawnRows: [0, 1, 4, 5] },
  onCombatStart(ctx) {
    ctx.addDarkOverlay(0.5);
    ctx.fillRowWater(2);
    ctx.fillRowWater(3);
    ctx.giftPlant(PLANT_PIDS.lily, 1, 0, 2);
    ctx.giftPlant(PLANT_PIDS.lily, 1, 0, 3);
    ctx.giftPlant(PLANT_PIDS.lily, 1, 1, 2);
    ctx.giftPlant(PLANT_PIDS.lily, 1, 1, 3);
  },
};

const stage8: StageModule = { metadata, content, script };
export default stage8;
