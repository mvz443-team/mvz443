// src/types/gameParams.ts

import type { StageResult } from "../../types/stage";
import type { ChapterDescription, StageDescription } from "../../types/drama";

export type { ChapterDescription, StageDescription } from "../../types/drama";

export type PlantSelection = {
  pid: number;
  level: number;
};

export interface GameParams {
  level: number; // 关卡号, 拼接字符串
  plants: Array<PlantSelection>; // 携带的植物以及其等级
  gameExit: (result: StageResult) => void;
  gameSettings: GameSettings;
  deviceType?: string;
  gold?: number;
  stageRows?: number;
  mainViewportWidth?: number;
  mainViewportHeight?: number;
  [key: string]: any; // 允许动态扩展其他参数
}

export interface GameSettings {
  fps?: number;
  isBluePrint: boolean;
  /** 旧 isDebug：Rapier 物理体与当前帧号显示。 */
  basicDebug: boolean;
  isBgm: boolean;
  isSoundAudio: boolean;
  showCardLevelInGame: boolean;
  bgmVolume?: number;
  soundAudioVolume?: number;
}
