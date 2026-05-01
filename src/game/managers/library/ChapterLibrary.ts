import type {
  ChapterDescription,
  ChapterDramaConfig,
  StageDescription,
} from "../../../types/drama";
import type { StageData } from "../../../types/stage";
import { publicUrl } from "../../../utils/browser";

const CHAPTER_INDEX_PATH = "stages/chapters/index.json";

type ChapterIndex = string[];
type StageMetadata = Pick<StageData, "nameKey" | "descriptionKey">;

export class ChapterLibrary {
  public static readonly ChapterDataRecords: Record<number, ChapterDescription> = {};
  public static readonly StageDataRecords: Record<number, StageDescription> = {};
  private static initializePromise: Promise<void> | null = null;

  public static async Initialize() {
    if (Object.keys(this.ChapterDataRecords).length > 0) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = this.LoadChapters();
    return this.initializePromise;
  }

  private static async LoadChapters() {
    const chapterFiles = await this.FetchJson<ChapterIndex>(CHAPTER_INDEX_PATH);
    for (const chapterFile of chapterFiles) {
      const chapterId = this.ParseId(chapterFile, "cp");
      const chapterData = await this.FetchJson<ChapterDramaConfig[]>(
        `stages/chapters/${chapterFile}`,
      );
      for (const chapter of chapterData) {
        await this.RegisterChapter(chapterId, chapter);
      }
    }
    console.log(`[ChapterLibrary] Initialized ${Object.keys(this.ChapterDataRecords).length} chapters, ${Object.keys(this.StageDataRecords).length} stages.`);
  }

  private static async RegisterChapter(chapterId: number, chapter: ChapterDramaConfig) {
    if (this.ChapterDataRecords[chapterId]) {
      console.warn(`[ChapterLibrary] Chapter ID ${chapterId} is already registered!`);
      return;
    }

    this.ChapterDataRecords[chapterId] = {
      id: chapterId,
      nameKey: chapter.nameKey,
      descriptionKey: chapter.descriptionKey,
      stages: [],
    };

    for (const stage of chapter.stages) {
      await this.RegisterStage(chapterId, stage);
    }
  }

  private static async RegisterStage(chapterId: number, stage: ChapterDramaConfig["stages"][number]) {
    const stageId = this.ParseId(stage.dataPath, "ch");
    if (this.StageDataRecords[stageId]) {
      console.warn(`[ChapterLibrary] Stage ID ${stageId} is already registered!`);
      return;
    }

    const stageMetadata = await this.FetchJson<StageMetadata>(stage.dataPath);
    this.StageDataRecords[stageId] = {
      id: stageId,
      chapterID: chapterId,
      nameKey: stageMetadata.nameKey,
      descriptionKey: stageMetadata.descriptionKey,
      dataPath: stage.dataPath,
    };
    this.ChapterDataRecords[chapterId].stages.push(stageId);
  }

  private static async FetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${publicUrl}/${path}`);
    if (!response.ok) {
      throw new Error(`[ChapterLibrary] Failed to load ${path}`);
    }
    return await response.json() as T;
  }

  private static ParseId(path: string, prefix: "cp" | "ch"): number {
    const match = new RegExp(`${prefix}(\\d+)\\.json$`).exec(path);
    if (!match) {
      throw new Error(`[ChapterLibrary] Cannot parse ${prefix} id from ${path}`);
    }
    return Number(match[1]);
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
