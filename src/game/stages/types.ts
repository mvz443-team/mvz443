/**
 * 关卡脚本类型定义（纯类型 + 纯常量，零运行时依赖）。
 *
 * 数据分层：
 * - `StageMetadata`：轻量元数据（id / 名称 key），同步常驻，供关卡列表 UI 使用；
 * - `StageData`：完整关卡配置（波次脚本、奖励、加载资源等），随 `StageModule` 懒加载；
 * - `LevelScript`：关卡特有逻辑（赠送植物、地形、波次事件），由管理器通过 `LevelScriptContext`
 *   注入副作用，脚本本身不 import 任何 Manager / Phaser。
 */
import type { StageData } from "../../types/stage";
import type { StageTerrainConfig } from "../utils/helper/StageTerrain";

/** 格子坐标（0-based）。 */
export interface GridCell {
  col: number;
  row: number;
}

/** BOSS 出场钩子（如蜈蚣）。 */
export interface BossHooks {
  onSpawn?: () => void;
  onHalfHealth?: () => void;
}

/**
 * 关卡事件标记键。管理器把具名快照布尔映射到这些键。
 * - collapse：崩塌动画/水面贴图表现已触发（表现层，立即生效）
 * - collapseWater：逻辑水格已由可恢复计时器改写（权威状态，延迟生效）
 * - lightsOut：熄灯事件已触发
 */
export type StageEventFlagKey = "collapse" | "collapseWater" | "lightsOut";

/** 崩塌格坐标的 JSON 安全表示（timer 快照参数，跨端/跨进程一致）。 */
export type GridCellArgs = Array<{ col: number; row: number }>;

/**
 * 关卡脚本可用的副作用入口。
 *
 * 所有会影响模拟状态的操作（改格子、昼夜、停产能、事件标记）都由管理器实现，
 * 脚本只调用这些方法，从而保持"关卡逻辑可扩展、管理器通用"。
 */
export interface LevelScriptContext {
  readonly stageId: number;
  readonly rows: number;
  readonly cols: number;
  /** 关卡预设赠送植物（不经过网络）。 */
  giftPlant(pid: number, level: number, col: number, row: number): void;
  /** 整行设为水格（开局地形）。 */
  fillRowWater(row: number): void;
  /** 单格设为水格。 */
  setCellWater(col: number, row: number): void;
  /**
   * 延迟把若干格改成水格（崩塌逻辑事件）。
   * 由可回滚/可恢复/可重连的全局 ticker 驱动，args 为 JSON 安全数据；
   * 到点后由稳定回调改写 GridManager 并置 collapseWater 标记。
   */
  scheduleCellWater(cells: readonly GridCell[], delayMs: number): void;
  /** 全屏暗色遮罩（纯表现）。 */
  addDarkOverlay(alpha: number): void;
  /** 设置昼夜（影响光敏植物与产能规则）。 */
  setDayOrNight(day: boolean): void;
  /** 停止自动产能。 */
  stopAutoEnergy(): void;
  /** 注册 BOSS 出场钩子。 */
  registerBossHooks(hooks: BossHooks): void;
  /** 崩塌落块 + 震屏表现（纯表现）。 */
  playCollapseVisual(cells: readonly GridCell[]): void;
  /** 光照闪烁表现（纯表现）。 */
  playLightFlicker(count: number): void;
  /** 重建/回收水面替代贴图（纯表现，幂等）。 */
  syncWaterTiles(cells: readonly GridCell[], visible: boolean): void;
  /** 读取关卡事件标记（进快照）。 */
  getFlag(key: StageEventFlagKey): boolean;
  /** 写入关卡事件标记（进快照）。 */
  setFlag(key: StageEventFlagKey, value: boolean): void;
}

/** 单个关卡的脚本逻辑。 */
export interface LevelScript {
  readonly id: string;
  /** 纯地形数据，供 StageHelper / 图鉴等无场景环境使用。 */
  readonly terrain?: StageTerrainConfig;
  /** 第 0 波（战斗开始）初始化。 */
  onCombatStart?(ctx: LevelScriptContext): void;
  /** 指定波次开始事件（必须幂等，回滚重放会重复触发）。 */
  onWaveStart?(ctx: LevelScriptContext, waveId: number): void;
  /** 回滚 / 重连后按事件标记重建视图。 */
  syncView?(ctx: LevelScriptContext): void;
}

/** 关卡轻量元数据（同步常驻）。 */
export interface StageMetadata {
  levelId: number;
  chapterId: number;
  nameKey: string;
  descriptionKey: string;
}

/** 章节轻量元数据。 */
export interface ChapterMetadata {
  chapterId: number;
  nameKey: string;
  descriptionKey: string;
  stages: readonly StageMetadata[];
}

/** 一个关卡的完整懒加载模块。 */
export interface StageModule {
  metadata: StageMetadata;
  content: StageData;
  script: LevelScript;
}

/** 一个章节的注册单元：元数据 + 每关的懒加载器。 */
export interface ChapterModule {
  metadata: ChapterMetadata;
  loaders: Record<number, () => Promise<{ default: StageModule }>>;
}
