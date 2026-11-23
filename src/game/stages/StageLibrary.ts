/**
 * 关卡库：同步元数据注册 + 完整关卡模块懒加载。
 *
 * - 元数据（id / 名称 key）在构造时从各章节同步注册，供关卡列表 UI 直接读取；
 * - 完整关卡（波次脚本、奖励、资源、脚本逻辑）通过动态 import 按需加载并缓存，
 *   避免一次性把所有关卡读入内存。
 */
import type {
  ChapterMetadata,
  ChapterModule,
  StageMetadata,
  StageModule,
} from "./types";
import { chapter1 } from "./chapter1/index.ts";

class StageLibraryImpl {
  private readonly chapters = new Map<number, ChapterMetadata>();
  private readonly stageMeta = new Map<number, StageMetadata>();
  private readonly loaders = new Map<number, () => Promise<{ default: StageModule }>>();
  private readonly loaded = new Map<number, StageModule>();
  private readonly pending = new Map<number, Promise<StageModule>>();
  private initialized = false;

  /** 注册一个章节（元数据 + 懒加载器）。 */
  public registerChapter(chapter: ChapterModule): void {
    this.chapters.set(chapter.metadata.chapterId, chapter.metadata);
    for (const stage of chapter.metadata.stages) {
      this.stageMeta.set(stage.levelId, stage);
      const loader = chapter.loaders[stage.levelId];
      if (loader) this.loaders.set(stage.levelId, loader);
    }
  }

  /** 幂等初始化：注册内置章节。 */
  public initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.registerChapter(chapter1);
  }

  public getChapters(): ChapterMetadata[] {
    this.initialize();
    return [...this.chapters.values()];
  }

  public getMetadata(stageId: number): StageMetadata | undefined {
    this.initialize();
    return this.stageMeta.get(stageId);
  }

  /** 懒加载完整关卡模块（带缓存与并发去重）。 */
  public async load(stageId: number): Promise<StageModule> {
    this.initialize();
    const cached = this.loaded.get(stageId);
    if (cached) return cached;
    const pending = this.pending.get(stageId);
    if (pending) return pending;

    const loader = this.loaders.get(stageId);
    if (!loader) {
      throw new Error(`[StageLibrary] stage ${stageId} is not registered.`);
    }
    const promise = loader()
      .then((mod) => {
        this.loaded.set(stageId, mod.default);
        this.pending.delete(stageId);
        return mod.default;
      })
      .catch((error) => {
        this.pending.delete(stageId);
        throw error;
      });
    this.pending.set(stageId, promise);
    return promise;
  }

  /** 已加载则同步返回；未加载返回 undefined（战斗内由 Preloader 保证已加载）。 */
  public getLoaded(stageId: number): StageModule | undefined {
    return this.loaded.get(stageId);
  }
}

export const StageLibrary = new StageLibraryImpl();
