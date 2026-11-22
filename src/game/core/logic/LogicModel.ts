/**
 * Model 层基类：唯一参与快照与回滚的对象。
 *
 * 约定：
 * - 所有会影响战斗结果的字段直接写在 Model 上，不需要 reg / logicFields / schema。
 * - 战斗逻辑（伤害计算、爆炸、 Debuff、技能分支）也写在 Model 上。
 * - Entity 只持有视图/物理胶水代码，通过 ModelHost 把世界能力借给 Model。
 */

import type { JsonValue, RestoreContext, TimerState } from "../SimulationState.ts";
import {
  bodyLayers,
  describeBodyLayers,
  type BodyLayers,
} from "./BodyTraits.ts";
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

  /**
   * 体态标签（tiny / flying / void），判定入口见 `BodyTraits.ts`。
   *
   * 对目标表示"占据哪一层"，对投射物/射线表示"能到达哪一层"。
   * 三个字段是普通布尔值，自动进入快照与哈希；不要用 Entity 自有字段遮蔽。
   */
  public tiny: boolean = false;
  public flying: boolean = false;
  public inVoid: boolean = false;

  /** 体态的可读描述；仅用于日志与断言，不参与模拟。 */
  public get bodyLayers(): BodyLayers {
    return bodyLayers(this);
  }

  public get bodyLayerNames(): string {
    return describeBodyLayers(this.bodyLayers);
  }

  /** 每个 Model 独立持有一个可快照定时器；非枚举，不进入 LogicState 快照。 */
  public readonly tickmanager!: ITickManagerProxy;
  /**
   * 本 Model 关心的计时器事件名列表。
   * 用原型 getter 而不是实例字段：声明式配置不进入快照，子类可覆写 getter。
   */
  public get tickEventNames(): readonly string[] {
    return DEFAULT_TICK_EVENT_NAMES;
  }
  /** 宿主实体引用；非枚举，不进入 LogicState 快照。 */
  public readonly host!: ModelHost | null;
  /** 静态配置（函数、工厂等）；非枚举，不进入 LogicState 快照。 */
  public readonly config!: Record<string, unknown>;

  constructor() {
    installTickManager(this);
    installConfig(this);
    // 返回代理：派生类字段初始化与后续赋值都自动进入 Undo Log。
    return trackLogicObject(this) as this;
  }

  /** 读取不参与快照的静态配置值。 */
  public getConfigValue<T>(key: string): T | undefined {
    return this.getConfigStorage()?.[key] as T | undefined;
  }

  /** 写入不参与快照的静态配置值；配置对象在实体 clone 间共享。 */
  protected setConfigValue(key: string, value: unknown): void {
    const config = this.getConfigStorage();
    if (config) config[key] = value;
  }

  private getConfigStorage(): Record<string, unknown> | undefined {
    return Object.getOwnPropertyDescriptor(this, "config")?.value as Record<string, unknown> | undefined;
  }

  /** 定时器到点后的统一入口；子类可覆写并按事件名分派业务。 */
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
    if (typeof context.nextTimerId === "number") {
      (this.tickmanager as EntityTickManager).setNextTimerId(context.nextTimerId);
    }
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
  Object.defineProperty(model, "host", {
    value: null,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

function installConfig(model: LogicModel, source?: Record<string, unknown>): void {
  const existing = Object.getOwnPropertyDescriptor(model, "config")?.value;
  Object.defineProperty(model, "config", {
    value: existing ?? source ?? {},
    enumerable: false,
    writable: false,
    configurable: true,
  });
}

export function cloneLogicModel<T extends LogicModel>(model: T): T {
  const config = Object.getOwnPropertyDescriptor(model, "config")?.value as Record<string, unknown> | undefined;
  const copy = Object.create(Object.getPrototypeOf(model)) as T;
  // 用 defineProperty 复制自有字段，避免触发原型上的 getter-only 配置属性。
  for (const key of Object.keys(model)) {
    Object.defineProperty(copy, key, {
      value: (model as unknown as Record<string, unknown>)[key],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  installTickManager(copy);
  installConfig(copy, config);
  return trackLogicObject(copy) as T;
}

export type TrackedModel<T extends LogicModel> = T & Tracked<T>;

/** 把 Model 字段以访问器形式挂到 Entity，兼容既有 `this.speed` 写法；存储仍在 Model。 */
export function attachModelAccessors(entity: object, model: LogicModel): void {
  for (const key of Object.keys(model)) {
    const source = model as unknown as Record<string, unknown>;
    if (key === "model" || typeof source[key] === "function") continue;
    // 原型上已有访问器（如 CombatEntity.maxHealth）时不能再定义同名自有属性，
    // 否则实体写 maxHealth 会覆盖 Model 上的 LevelScaledValue 配置。
    if (key in entity) continue;
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
