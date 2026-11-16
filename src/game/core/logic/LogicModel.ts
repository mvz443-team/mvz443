/**
 * Model 层基类：唯一参与快照与回滚的对象。
 *
 * 约定：
 * - 所有会影响战斗结果的字段直接写在 Model 上，不需要 reg / logicFields / schema。
 * - 战斗逻辑（伤害计算、爆炸、 Debuff、技能分支）也写在 Model 上。
 * - Entity 只持有视图/物理胶水代码，通过 ModelHost 把世界能力借给 Model。
 */

import type { JsonValue, RestoreContext, TimerState } from "../SimulationState.ts";
import { EntityTickManager, type ITickManagerProxy } from "./EntityTickManager.ts";
import { getLogicHandle, trackLogicObject, type Tracked } from "./LogicState.ts";
import {
  DEFAULT_TICK_EVENT_NAMES,
  TickEventNameEnums,
  invokeTickEventCallback,
} from "./TickEvents.ts";

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
  /** Model 状态变化后请求 Entity 单向刷新视图；Entity 不反向保存业务状态。 */
  syncViewFromModel?(): void;
  emit(type: string, data?: JsonValue): void;
}

export abstract class LogicModel {
  /** 通用战斗状态；字段名避开 Model 上的静态配置 maxHealth。 */
  public health: number = 0;
  public healthMax: number = 0;

  /** 每个 Model 独立持有一个可快照定时器；非枚举，不进入 LogicState 快照。 */
  public readonly tickmanager!: ITickManagerProxy;
  /** 本 Model 关心的计时器事件名列表。 */
  public readonly tickEventNames!: readonly TickEventNameEnums[];
  /** 宿主实体引用；非枚举，不进入 LogicState 快照。 */
  public readonly host!: ModelHost | null;

  constructor() {
    installTickManager(this);
    // 返回代理：派生类字段初始化与后续赋值都自动进入 Undo Log。
    return trackLogicObject(this) as this;
  }

  /** 定时器到点后的统一入口；子类可覆写并按枚举分派业务。 */
  public handleTickEvent(
    eventName: TickEventNameEnums | string,
    args: JsonValue = null,
    _timerId?: number,
  ): void {
    if (eventName === TickEventNameEnums.TimerTriggered) {
      const name = args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, JsonValue>).eventName
        : null;
      if (typeof name === "string") invokeTickEventCallback(name);
      return;
    }
    invokeTickEventCallback(String(eventName));
  }

  public stepTick(): void {
    this.tickmanager.update();
  }

  public setTickOwnerId(ownerId: string): void {
    this.tickmanager.setOwnerId(ownerId);
  }

  /** 由 Entity 构造时绑定；Entity 不持有 timer，只作为 Model 访问世界的宿主。 */
  public attachHost(host: ModelHost): void {
    Object.defineProperty(this, "host", {
      value: host,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  public captureTimers(): TimerState[] {
    return this.tickmanager.capture();
  }

  public restoreTimers(states: TimerState[], context: RestoreContext): void {
    this.tickmanager.restore(states, context);
  }

  public disposeTickManager(): void {
    (this.tickmanager as EntityTickManager).dispose?.();
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

function installTickManager(model: LogicModel): void {
  Object.defineProperty(model, "tickmanager", {
    value: new EntityTickManager(model),
    enumerable: false,
    writable: false,
    configurable: true,
  });
  Object.defineProperty(model, "tickEventNames", {
    value: [...DEFAULT_TICK_EVENT_NAMES],
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(model, "host", {
    value: null,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

export function cloneLogicModel<T extends LogicModel>(model: T): T {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(model)), model) as T;
  installTickManager(copy);
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
