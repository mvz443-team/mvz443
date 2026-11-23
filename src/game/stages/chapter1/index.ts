/**
 * 第一章注册单元：轻量元数据 + 每关的懒加载器。
 *
 * 懒加载器使用动态 import，构建时每关拆成独立 chunk，只有进入该关时才加载其
 * 完整配置与脚本，避免一次性把所有关卡读入内存。
 */
import type { ChapterModule } from "../types";
import { CHAPTER1_METADATA } from "./metadata.ts";

export const chapter1: ChapterModule = {
  metadata: CHAPTER1_METADATA,
  loaders: {
    1: () => import("./stage1.ts"),
    2: () => import("./stage2.ts"),
    3: () => import("./stage3.ts"),
    4: () => import("./stage4.ts"),
    5: () => import("./stage5.ts"),
    6: () => import("./stage6.ts"),
    7: () => import("./stage7.ts"),
    8: () => import("./stage8.ts"),
    9: () => import("./stage9.ts"),
  },
};
