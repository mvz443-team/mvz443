import type { StageData } from "../../../types/stage";
import type { LevelScript, StageModule } from "../types";
import { PLANT_PIDS } from "../../presets/plant/pids.ts";
import { CHAPTER1_STAGES } from "./metadata.ts";

const metadata = CHAPTER1_STAGES.find((s) => s.levelId === 1)!;

const content: StageData = {
  ...metadata,
  levelIntro: [
    { type: "img", src: "img/sg1.png" },
    { type: "text", content: "sg1" },
  ],
  rows: 5,
  type: 1,
  stageScript: {
    first_wave_id: 0,
    total_waves: 12,
    base_difficulty: 0,
    difficulty_limit: 14,
    phase1_end: 4,
    phase2_end: 8,
    dayOrNight: 1,
    flagWaves: [10, 20],
    AllowedMobs: [1, 2, 3, 8],
    globalRatio: [[0, 1]],
    bossInsert: [],
  },
  onWin: {
    unLock: [{ chapterId: 1, levelId: 2 }],
    unLockPlant: [1, 2, 3, 4, 7],
  },
  energy: 100,
  rewards: [
    { progress: 45, reward: { id: 1, number: 45 } },
    { progress: 85, reward: { id: 1, number: 55 } },
    { progress: 95, reward: { id: 2, number: 1 } },
  ],
  load: {
    bgimg: ["bg/bgDay.png"],
    bgm: ["audio/QLCK-002-05.mp3"],
    plants: [1, 2],
  },
};

const script: LevelScript = {
  id: "ch1_stage1",
  terrain: { earlySpawnRows: [0, 4] },
  onCombatStart(ctx) {
    ctx.giftPlant(PLANT_PIDS.dispenser, 1, 0, 0);
    ctx.giftPlant(PLANT_PIDS.dispenser, 1, 0, 4);
    ctx.giftPlant(PLANT_PIDS.furnace, 1, 1, 1);
    ctx.giftPlant(PLANT_PIDS.furnace, 1, 1, 2);
    ctx.giftPlant(PLANT_PIDS.furnace, 1, 1, 3);
  },
};

const stage1: StageModule = { metadata, content, script };
export default stage1;
