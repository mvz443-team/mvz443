/**
 * 第一章轻量元数据（同步常驻，供关卡列表 UI 使用）。
 *
 * 只含 id / 名称 key，不含波次脚本、奖励、资源路径等重数据；
 * 重数据在各自的 `stageN.ts` 中懒加载。
 */
import type { ChapterMetadata, StageMetadata } from "../types";

export const CHAPTER1_STAGES: readonly StageMetadata[] = [
  { levelId: 1, chapterId: 1, nameKey: "level_sg1", descriptionKey: "sg1" },
  { levelId: 2, chapterId: 1, nameKey: "level_sg2", descriptionKey: "sg2" },
  { levelId: 3, chapterId: 1, nameKey: "level_sg3", descriptionKey: "sg3" },
  { levelId: 4, chapterId: 1, nameKey: "level_sg4", descriptionKey: "sg4" },
  { levelId: 5, chapterId: 1, nameKey: "level_sg5", descriptionKey: "sg5" },
  { levelId: 6, chapterId: 1, nameKey: "level_sg6", descriptionKey: "sg6" },
  { levelId: 7, chapterId: 1, nameKey: "level_sg7", descriptionKey: "sg7" },
  { levelId: 8, chapterId: 1, nameKey: "level_sg8", descriptionKey: "sg8" },
  { levelId: 9, chapterId: 1, nameKey: "level_sg9", descriptionKey: "sg9" },
];

export const CHAPTER1_METADATA: ChapterMetadata = {
  chapterId: 1,
  nameKey: "chapter_cp1",
  descriptionKey: "cp1",
  stages: CHAPTER1_STAGES,
};
