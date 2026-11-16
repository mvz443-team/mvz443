/**
 * Model 层基类：唯一参与快照与回滚的对象。
 *
 * 约定：
 * - 所有会影响战斗结果的字段直接写在 Model 上，不需要 reg / logicFields / schema。
 * - 战斗逻辑（伤害计算、爆炸、 Debuff、技能分支）也写在 Model 上。
 * - Entity 只持有视图/物理胶水代码，通过 ModelHost 把世界能力借给 Model。
 */

import type { JsonValue } from "../SimulationState.ts";
import { getLogicHandle, trackLogicObject, type Tracked } from "./LogicState.ts";

/** Entity 提供给 Model 的最小世界能力，避免 Model 依赖 Phaser/Rapier。 */
export interface ModelHost {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly row?: number;
  readonly col?: number;
  readonly faction?: number;
  readonly dealer?: unknown;
  readonly gridSizeX: number;
  readonly explosionDamage?: number;
  hasExploded?: boolean;
  createExplosion(config: Record<string, unknown>, x?: number, y?: number, row?: number): void;
  createProjectile(model: unknown, config: Record<string, unknown>): void;
  applyDebuffTo(target: unknown, name: string, durationMs: number): void;
  applyDamage(target: unknown, amount: number, dealer: unknown, source: unknown): void;
  hasAttacked(target: unknown): boolean;
  markAttacked(target: unknown): void;
  hasPenetrated(target: unknown): boolean;
  markPenetrated(target: unknown): void;
  destroySelf(): void;
  setEnhancement?(value: string): void;
  emit(type: string, data?: JsonValue): void;
}

export abstract class LogicModel {
  /** 通用战斗状态；字段名避开 Model 上的静态配置 maxHealth。 */
  public health: number = 0;
  public healthMax: number = 0;

  constructor() {
    // 返回代理：派生类字段初始化与后续赋值都自动进入 Undo Log。
    return trackLogicObject(this) as this;
  }

  onModelStep?(_host: ModelHost): void { }
  onModelCollision?(_host: ModelHost, _target: unknown): void { }
  onModelDestroy?(_host: ModelHost): void { }
  onModelHurt?(_host: ModelHost, amount: number, realDamage: number): void { }
  onModelStarShards?(_host: ModelHost): void { }

  /** 每个实体实例必须拿到独立的 Model 副本，避免共享单例导致状态串线。 */
  public clone<T extends LogicModel>(this: T): T {
    return cloneLogicModel(this);
  }
}

export function cloneLogicModel<T extends LogicModel>(model: T): T {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(model)), model) as T;
  return trackLogicObject(copy) as T;
}

export type TrackedModel<T extends LogicModel> = T & Tracked<T>;

/** 把 Model 字段以访问器形式挂到 Entity，兼容既有 `this.speed` 写法；存储仍在 Model。 */
export function attachModelAccessors(entity: object, model: LogicModel): void {
  for (const key of Object.keys(model)) {
    const source = model as unknown as Record<string, unknown>;
    if (key === "model" || typeof source[key] === "function") continue;
    if (Object.prototype.hasOwnProperty.call(entity, key)) continue;
    Object.defineProperty(entity, key, {
      configurable: true,
      enumerable: false,
      get: () => source[key],
      set: (value: unknown) => { source[key] = value; },
    });
  }
}

/** 快照 Model 中全部确定性字段。 */
export function snapshotModel(model: LogicModel): Record<string, JsonValue> {
  return getLogicHandle(model)?.snapshot() as Record<string, JsonValue> ?? {};
}

/** 把快照写回 Model（只覆盖运行时字段，不动配置）。 */
export function restoreModel(model: LogicModel, state: Record<string, JsonValue>): void {
  getLogicHandle(model)?.restore(state);
}

/** 同步逻辑帧号到 Model 与全局事件队列。 */
export function setModelFrame(model: LogicModel, frame: number, events?: { setFrame(frame: number): void }): void {
  getLogicHandle(model)?.setFrame(frame);
  events?.setFrame(frame);
}
