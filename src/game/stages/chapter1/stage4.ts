import type { StageData } from "../../../types/stage";
import type { LevelScript, StageModule } from "../types";
import { PLANT_PIDS } from "../../presets/plant/pids.ts";
import { CHAPTER1_STAGES } from "./metadata.ts";

const metadata = CHAPTER1_STAGES.find((s) => s.levelId === 4)!;

const content: StageData = {
  ...metadata,
  levelIntro: [
    { type: "img", src: "img/sg4.png" },
    { type: "text", content: "sg4" },
  ],
  rows: 6,
  type: 1,
  stageScript: {
    first_wave_id: 0,
    total_waves: 27,
    base_difficulty: 0,
    difficulty_limit: 32,
    phase1_end: 10,
    phase2_end: 16,
    dayOrNight: 2,
    flagWaves: [10, 18, 25],
    AllowedMobs: [1, 2, 3, 8, 5, 9, 11, 14, 16],
    globalRatio: [[0, 1.4]],
    bossInsert: [],
  },
  onWin: {
    unLock: [{ chapterId: 1, levelId: 5 }],
    unLockPlant: [6, 10],
  },
  energy: 50,
  rewards: [
    { progress: 60, reward: { id: 1, number: 40 } },
    { progress: 75, reward: { id: 3, number: 2 } },
    { progress: 95, reward: { id: 1, number: 110 } },
  ],
  load: {
    bgimg: ["bg/bgDeepMine.png"],
    bgm: ["audio/OLJA-0021-08.ogg"],
  },
};

const script: LevelScript = {
  id: "ch1_stage4",
  onCombatStart(ctx) {
    ctx.addDarkOverlay(0.5);
    ctx.giftPlant(PLANT_PIDS.generator, 1, 5, 1);
    ctx.giftPlant(PLANT_PIDS.generator, 1, 5, 4);
  },
};

const stage4: StageModule = { metadata, content, script };
export default stage4;
