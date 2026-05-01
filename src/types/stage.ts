import type { LevelIntroItem } from "./drama";

export interface StageScript {
  first_wave_id: number;
  total_waves: number;
  base_difficulty: number;
  difficulty_limit: number;
  phase1_end: number;
  phase2_end: number;
  dayOrNight: number;
  flagWaves: number[];
  waterWays: number[];
  AllowedMobs: number[];
  globalRatio: [number, number][];
  bossInsert: [number, number][];
}

export interface Monster {
  mid: number;
  count: number;
}

export interface Wave {
  waveId: number;
  progress: number;
  flag: string;
  isFlag: boolean;
  monsters: Monster[];
  duration: number;
  maxDelay: number;
  minDelay: number;
  arrangement: 0x01 | 0x02;
  minLine: number;
  exceptLine: number[];
  starShards: number;
}

export interface Reward {
  type: number;
  count: number;
}

export interface ProgressReward {
  progress: number;
  reward: Reward;
}

export interface OnWin {
  unLock: number[];
  unLockPlant: number[];
}

export interface StageResult {
  isWin: boolean;
  onWin: OnWin;
  rewards: ProgressReward[];
  progress: number;
}

export interface PreloadData {
  bgimg: string[];
  bgm: string[];
  plants?: number[];
}

export interface StageData {
  nameKey: string;
  descriptionKey: string;
  levelIntro?: LevelIntroItem[];
  rows: number;
  type: number;
  stageScript: StageScript;
  onWin: OnWin;
  energy: number;
  rewards: ProgressReward[];
  load: PreloadData;
}
