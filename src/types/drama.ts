export type LevelIntroItem =
  | {
    type: "text";
    content: string;
  }
  | {
    type: "img";
    src: string;
  };

export interface ChapterDescription {
  id: number;
  nameKey: string;
  descriptionKey: string;
  stages: number[];
}

export interface StageDescription {
  id: number;
  levelId: number;
  chapterId: number;
  nameKey: string;
  descriptionKey: string;
}
