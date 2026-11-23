import type { StageData } from "../../../types/stage";
import type { LevelScript, StageModule } from "../types";
import { PLANT_PIDS } from "../../presets/plant/pids.ts";
import { CHAPTER1_STAGES } from "./metadata.ts";

const metadata = CHAPTER1_STAGES.find((s) => s.levelId === 2)!;

const content: StageData = {
  ...metadata,
  levelIntro: [
    { type: "img", src: "img/sg2.png" },
    { type: "text", content: "sg2" },
  ],
  rows: 6,
  type: 1,
  stageScript: {
    first_wave_id: 0,
    total_waves: 22,
    base_difficulty: 0,
    difficulty_limit: 25,
    phase1_end: 11,
    phase2_end: 16,
    dayOrNight: 1,
    flagWaves: [10, 20],
    AllowedMobs: [1, 2, 3, 8, 4, 5, 7, 14],
    globalRatio: [[0, 1.2]],
    bossInsert: [],
  },
  onWin: {
    unLock: [{ chapterId: 1, levelId: 3 }],
    unLockPlant: [5],
  },
  energy: 50,
  rewards: [
    { progress: 45, reward: { id: 1, number: 45 } },
    { progress: 65, reward: { id: 1, number: 70 } },
    { progress: 95, reward: { id: 3, number: 1 } },
  ],
  load: {
    bgimg: ["bg/bgOutterMine.png"],
    bgm: ["audio/QLCK-002-05.mp3"],
  },
};

const script: LevelScript = {
  id: "ch1_stage2",
  onCombatStart(ctx) {
    ctx.giftPlant(PLANT_PIDS.furnace, 1, 1, 1);
    ctx.giftPlant(PLANT_PIDS.furnace, 1, 1, 2);
    ctx.giftPlant(PLANT_PIDS.furnace, 1, 1, 3);
  },
};

const stage2: StageModule = { metadata, content, script };
export default stage2;
