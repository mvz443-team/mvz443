import type { StageData } from "../../../types/stage";
import type { LevelScript, StageModule } from "../types";
import { PLANT_PIDS } from "../../presets/plant/pids.ts";
import { CHAPTER1_STAGES } from "./metadata.ts";

const metadata = CHAPTER1_STAGES.find((s) => s.levelId === 7)!;

const content: StageData = {
  ...metadata,
  levelIntro: [
    { type: "img", src: "img/sg7.png" },
    { type: "text", content: "sg7" },
  ],
  rows: 4,
  type: 1,
  stageScript: {
    first_wave_id: 0,
    total_waves: 32,
    base_difficulty: 0,
    difficulty_limit: 55,
    phase1_end: 11,
    phase2_end: 22,
    dayOrNight: 2,
    flagWaves: [10, 20, 30],
    AllowedMobs: [1, 2, 3, 8, 5, 7, 9, 11, 14, 15, 16],
    globalRatio: [[0, 1], [21, 2]],
    bossInsert: [[31, 12]],
  },
  onWin: {
    unLock: [{ chapterId: 1, levelId: 8 }],
    unLockPlant: [13],
  },
  energy: 50,
  rewards: [
    { progress: 75, reward: { id: 1, number: 100 } },
    { progress: 90, reward: { id: 2, number: 3 } },
    { progress: 90, reward: { id: 3, number: 2 } },
    { progress: 100, reward: { id: 1, number: 140 } },
    { progress: 100, reward: { id: 4, number: 2 } },
  ],
  load: {
    bgimg: ["bg/bgInnerMine.png"],
    bgm: ["audio/ARCD-0036-09.ogg", "audio/ZCDS-0014-05.ogg"],
    plants: [1, 2],
  },
};

const script: LevelScript = {
  id: "ch1_stage7",
  terrain: { earlySpawnRows: [0] },
  onCombatStart(ctx) {
    ctx.addDarkOverlay(0.5);
    ctx.giftPlant(PLANT_PIDS.smallDispenser, 1, 4, 1);
    ctx.giftPlant(PLANT_PIDS.smallDispenser, 1, 4, 2);
    ctx.giftPlant(PLANT_PIDS.furnace, 1, 1, 1);
    ctx.giftPlant(PLANT_PIDS.furnace, 1, 1, 2);
  },
};

const stage7: StageModule = { metadata, content, script };
export default stage7;
