import type { ChapterDescription, StageDescription } from "../../../types/drama";
import { StageLibrary } from "../../stages/StageLibrary";

/**
 * 章节 / 关卡轻量元数据注册表。
 *
 * 关卡配置已从 JSON 迁到 `src/game/stages/**` 的 ts 模块：本类只同步构建
 * id / 名称 key 等轻量元数据（供关卡列表、结算页等 UI 直接读取），
 * 完整关卡数据与脚本由 `StageLibrary.load(stageId)` 懒加载。
 */
export class ChapterLibrary {
  public static readonly ChapterDataRecords: Record<number, ChapterDescription> = {};
  public static readonly StageDataRecords: Record<number, StageDescription> = {};

  public static async Initialize(): Promise<void> {
    if (Object.keys(this.ChapterDataRecords).length > 0) return;
    StageLibrary.initialize();
    for (const chapter of StageLibrary.getChapters()) {
      if (this.ChapterDataRecords[chapter.chapterId]) {
        console.warn(`[ChapterLibrary] Chapter ID ${chapter.chapterId} is already registered!`);
        continue;
      }
      this.ChapterDataRecords[chapter.chapterId] = {
        id: chapter.chapterId,
        nameKey: chapter.nameKey,
        descriptionKey: chapter.descriptionKey,
        stages: chapter.stages.map((stage) => stage.levelId),
      };
      for (const stage of chapter.stages) {
        if (this.StageDataRecords[stage.levelId]) {
          console.warn(`[ChapterLibrary] Stage ID ${stage.levelId} is already registered!`);
          continue;
        }
        this.StageDataRecords[stage.levelId] = {
          id: stage.levelId,
          levelId: stage.levelId,
          chapterId: stage.chapterId,
          nameKey: stage.nameKey,
          descriptionKey: stage.descriptionKey,
        };
      }
    }
    console.log(
      `[ChapterLibrary] Initialized ${Object.keys(this.ChapterDataRecords).length} chapters, `
      + `${Object.keys(this.StageDataRecords).length} stages.`,
    );
  }

  public static GetChapter(chapterId: number): ChapterDescription | undefined {
    return this.ChapterDataRecords[chapterId];
  }

  public static GetStage(stageId: number): StageDescription | undefined {
    return this.StageDataRecords[stageId];
  }

  public static GetAllChapters(): ChapterDescription[] {
    return Object.values(this.ChapterDataRecords);
  }

  public static GetAllStages(): StageDescription[] {
    return Object.values(this.StageDataRecords);
  }
}

export const ChapterDataRecords = ChapterLibrary.ChapterDataRecords;
export const StageDataRecords = ChapterLibrary.StageDataRecords;
