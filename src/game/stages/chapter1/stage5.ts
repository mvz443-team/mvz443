import type { StageData } from "../../../types/stage";
import type { LevelScript, StageModule } from "../types";
import { PLANT_PIDS } from "../../presets/plant/pids.ts";
import { CHAPTER1_STAGES } from "./metadata.ts";

const metadata = CHAPTER1_STAGES.find((s) => s.levelId === 5)!;

const content: StageData = {
  ...metadata,
  levelIntro: [
    { type: "img", src: "img/sg5.png" },
    { type: "text", content: "sg5" },
  ],
  rows: 6,
  type: 1,
  stageScript: {
    first_wave_id: 0,
    total_waves: 27,
    base_difficulty: 0,
    difficulty_limit: 32,
    phase1_end: 11,
    phase2_end: 24,
    dayOrNight: 2,
    flagWaves: [10, 18, 25],
    AllowedMobs: [1, 2, 3, 8, 5, 7, 9, 11, 14, 16],
    globalRatio: [[0, 1.3]],
    bossInsert: [],
  },
  onWin: {
    unLock: [{ chapterId: 1, levelId: 6 }],
    unLockPlant: [12],
  },
  energy: 50,
  rewards: [
    { progress: 55, reward: { id: 1, number: 70 } },
    { progress: 75, reward: { id: 2, number: 2 } },
    { progress: 95, reward: { id: 1, number: 100 } },
    { progress: 98, reward: { id: 3, number: 1 } },
  ],
  load: {
    bgimg: ["bg/bgDeepMineWater.png"],
    bgm: ["audio/OLJA-0021-08.ogg"],
  },
};

const script: LevelScript = {
  id: "ch1_stage5",
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

const stage5: StageModule = { metadata, content, script };
export default stage5;
