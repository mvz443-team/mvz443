import type { StageData } from "../../../types/stage";
import type { LevelScript, StageModule } from "../types";
import { PLANT_PIDS } from "../../presets/plant/pids.ts";
import { CHAPTER1_STAGES } from "./metadata.ts";

const metadata = CHAPTER1_STAGES.find((s) => s.levelId === 3)!;

const content: StageData = {
  ...metadata,
  levelIntro: [
    { type: "img", src: "img/sg3.png" },
    { type: "text", content: "sg3" },
  ],
  rows: 4,
  type: 1,
  stageScript: {
    first_wave_id: 0,
    total_waves: 22,
    base_difficulty: 0,
    difficulty_limit: 25,
    phase1_end: 12,
    phase2_end: 20,
    dayOrNight: 2,
    flagWaves: [10, 25],
    AllowedMobs: [1, 3, 8, 4, 5, 7, 14, 16],
    globalRatio: [[0, 1.3]],
    bossInsert: [],
  },
  onWin: {
    unLock: [{ chapterId: 1, levelId: 4 }],
    unLockPlant: [8, 9],
  },
  energy: 100,
  rewards: [
    { progress: 65, reward: { id: 1, number: 50 } },
    { progress: 85, reward: { id: 1, number: 80 } },
    { progress: 94, reward: { id: 2, number: 2 } },
  ],
  load: {
    bgimg: ["bg/bgInnerMine.png"],
    bgm: ["audio/ARCD-0036-09.ogg"],
  },
};

const script: LevelScript = {
  id: "ch1_stage3",
  onCombatStart(ctx) {
    ctx.addDarkOverlay(0.3);
    ctx.giftPlant(PLANT_PIDS.smallDispenser, 1, 4, 1);
    ctx.giftPlant(PLANT_PIDS.smallDispenser, 1, 4, 2);
  },
};

const stage3: StageModule = { metadata, content, script };
export default stage3;
