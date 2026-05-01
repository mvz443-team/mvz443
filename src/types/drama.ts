export type LevelIntroItem =
  | {
    type: "text";
    content: string;
  }
  | {
    type: "img";
    src: string;
  };

export interface StageDramaConfig {
  dataPath: string;
}

export interface ChapterDramaConfig {
  nameKey: string;
  descriptionKey: string;
  stages: StageDramaConfig[];
}

export interface ChapterDescription {
  id: number;
  nameKey: string;
  descriptionKey: string;
  stages: number[];
}

export interface StageDescription {
  id: number;
  chapterID: number;
  nameKey: string;
  descriptionKey: string;
  dataPath: string;
}
