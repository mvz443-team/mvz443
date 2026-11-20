/**
 * 实体专属帧定时器（可快照 / 可回滚 / 无闭包状态）。
 *
 * 设计要点：
 * - 每个 LogicModel 持有一个独立实例，不共享全局 timer 列表。
 * - timer 本体只保存 id / eventName / targetFrame / repeat / interval / group / args，
 *   全部为 JSON 安全数据；callback/context 只存在于 TickEvents 的稳定注册表。
 * - 到点后向宿主 LogicModel 派发事件名，由 handleTickEvent 处理。
 * - 同一 callback 只注册一次，回滚不会重新创建函数对象。
 */

const LEGACY_BALANCE_FRAME_INTERVAL_MS = 50;
import type { JsonValue, RestoreContext, TimerState } from "../SimulationState.ts";
import { isLogicValue } from "./LogicState.ts";
import {
  TickEventNameEnums,
  registerTickEventCallback,
} from "./TickEvents.ts";

export interface TickDelayedCallConfig {
  callback: (...args: any[]) => void;
  delay: number;
  args?: any[];
  context?: any;
  snapshot?: { kind?: string; args?: JsonValue };
}

export interface TickAddEventConfig {
  callback: (...args: any[]) => void;
  delay: number;
  args?: any[];
  context?: any;
  repeat?: number;
  startAt?: number;
  loop?: boolean;
  snapshot?: { kind?: string; args?: JsonValue };
}

export interface TickScheduleOptions {
  repeat?: number;
  startAt?: number;
  loop?: boolean;
  args?: JsonValue;
}

/** 与旧 FrameTimer 句柄兼容的最小接口。 */
export interface ITickTimerHandle {
  readonly id: number;
  targetFrame: number;
  repeat: number;
  interval: number;
  group: string;
  GetLeftTimeByFrame(): number;
  GetLeftTimeByMs(): number;
  remove(): void;
}

/** LogicModel 持有的定时器接口；Entity 不再依赖它。 */
export interface ITickManagerProxy {
  delayedCall(config: TickDelayedCallConfig): ITickTimerHandle;
  addEvent(config: TickAddEventConfig): ITickTimerHandle;
  Register(
    callback: (...args: any[]) => void,
    delay: number,
    args?: any[],
    context?: any,
    repeat?: number,
    snapshot?: { kind?: string; args?: JsonValue },
  ): ITickTimerHandle;
  /** 纯枚举事件定时器：推荐业务使用，完全不接触函数。 */
  schedule(
    eventName: TickEventNameEnums | string,
    delay: number,
    options?: TickScheduleOptions,
  ): ITickTimerHandle;
  setOwnerId(ownerId: string): void;
  setFrame(frame: number, frameIntervalMs?: number): void;
  update(): void;
  capture(): TimerState[];
  restore(states: TimerState[], context: RestoreContext): void;
  setNextTimerId(nextId: number): void;
  getNextTimerId(): number;
  /**
   * 按事件名清除本 Model 的定时器。
   *
   * Entity 上的 timer 句柄不进入快照，跨进程重连重建后已经失效；
   * 需要"停掉某类循环"时必须能只凭事件名清理，否则重连端的旧循环会继续跑。
   */
  removeByEvent(eventName: TickEventNameEnums | string): number;
  clear(): void;
}

interface EntityTimerRecord {
  id: number;
  eventName: string;
  targetFrame: number;
  repeat: number;
  interval: number;
  group: string;
  args: JsonValue;
}

class TickTimerHandle implements ITickTimerHandle {
  public readonly id: number;
  public targetFrame: number;
  public repeat: number;
  public interval: number;
  public group: string;
  private readonly manager: EntityTickManager;

  constructor(
    id: number,
    targetFrame: number,
    repeat: number,
    interval: number,
    group: string,
    manager: EntityTickManager,
  ) {
    this.id = id;
    this.targetFrame = targetFrame;
    this.repeat = repeat;
    this.interval = interval;
    this.group = group;
    this.manager = manager;
  }

  public GetLeftTimeByFrame(): number {
    return this.targetFrame - this.manager.currentFrame;
  }

  public GetLeftTimeByMs(): number {
    return this.GetLeftTimeByFrame() * this.manager.frameInterval;
  }

  public remove(): void {
    this.manager.remove(this.id);
  }
}

type TickEventSink = {
  handleTickEvent(eventName: TickEventNameEnums | string, args?: JsonValue, timerId?: number): void;
};

const managedTickManagers = new Set<EntityTickManager>();
let currentLogicFrame = 0;
let currentFrameInterval = LEGACY_BALANCE_FRAME_INTERVAL_MS;
/**
 * 权威逻辑帧：最近一次被网络层确认并执行的帧。
 *
 * 实体创建可能被 DeferredManager 推迟到 flush 执行，而 flush 的时机受渲染
 * 循环、暂停恢复影响。若 timer 直接读 ticker.currentFrame，同一操作在两端
 * 可能以不同帧为起点（例如 frame 212 vs 215），第一个 timer 的 targetFrame
 * 随即分叉。创建实体时必须以“触发创建的操作帧”为起点，而不是执行时刻。
 */
let authoritativeFrame = 0;
let pendingCreationFrame: number | null = null;

export class EntityTickManager implements ITickManagerProxy {
  public currentFrame = pendingCreationFrame ?? (authoritativeFrame || currentLogicFrame);
  public frameInterval = currentFrameInterval;

  private ownerId = "entity";
  private nextTimerId = 1;
  private readonly timers = new Map<number, EntityTimerRecord>();
  private readonly handles = new Map<number, TickTimerHandle>();
  /**
   * 本 tickmanager 自己注册过的回调句柄。
   * 用于区分「同进程回滚（句柄仍有效）」与「跨进程重连（句柄已失效）」：
   * 快照里的 `callback:N` 只有在属于本实例时才允许沿用。
   */
  private readonly ownCallbackHandles = new Set<string>();

  private readonly sink: TickEventSink;

  constructor(sink: TickEventSink) {
    this.sink = sink;
    managedTickManagers.add(this);
  }

  public setOwnerId(ownerId: string): void {
    if (!ownerId) return;
    const previous = this.ownerId;
    this.ownerId = ownerId;
    if (previous === ownerId) return;
    for (const timer of this.timers.values()) timer.group = ownerId;
    for (const handle of this.handles.values()) handle.group = ownerId;
  }

  public getOwnerId(): string {
    return this.ownerId;
  }

  /** 供快照恢复使用：实体计时器的下一个 id 必须与快照一致。 */
  public setNextTimerId(nextId: number): void {
    this.nextTimerId = Number.isFinite(nextId) ? Math.max(1, Math.trunc(nextId)) : 1;
  }

  public getNextTimerId(): number {
    return this.nextTimerId;
  }

  public setFrame(frame: number, frameIntervalMs?: number): void {
    this.currentFrame = Math.trunc(frame);
    if (typeof frameIntervalMs === "number" && frameIntervalMs > 0) {
      this.frameInterval = frameIntervalMs;
    }
  }

  public delayedCall(config: TickDelayedCallConfig): ITickTimerHandle {
    return this.registerCallback(
      config.callback,
      config.delay,
      config.args ?? [],
      config.context ?? null,
      0,
      config.snapshot,
    );
  }

  public addEvent(config: TickAddEventConfig): ITickTimerHandle {
    const repeat = config.loop ? -1 : (config.repeat ?? -1);
    return this.registerCallback(
      config.callback,
      config.delay,
      config.args ?? [],
      config.context ?? null,
      repeat,
      config.snapshot,
      config.startAt ?? 0,
    );
  }

  public Register(
    callback: (...args: any[]) => void,
    delay: number,
    args: any[] = [],
    context: any = null,
    repeat = 0,
    snapshot?: { kind?: string; args?: JsonValue },
  ): ITickTimerHandle {
    return this.registerCallback(callback, delay, args, context, repeat, snapshot);
  }

  public schedule(
    eventName: TickEventNameEnums | string,
    delay: number,
    options: TickScheduleOptions = {},
  ): ITickTimerHandle {
    const repeat = options.loop ? -1 : (options.repeat ?? 0);
    return this.createTimer(
      String(eventName),
      delay,
      repeat,
      options.startAt ?? 0,
      options.args ?? null,
    );
  }

  private registerCallback(
    callback: (...args: any[]) => void,
    delay: number,
    args: any[],
    context: any,
    repeat: number,
    snapshot?: { kind?: string; args?: JsonValue },
    startAt = 0,
  ): ITickTimerHandle {
    if (snapshot?.kind) {
      return this.createTimer(snapshot.kind, delay, repeat, startAt, snapshot.args ?? null);
    }
    const callbackEventName = registerTickEventCallback(callback, args, context);
    this.ownCallbackHandles.add(callbackEventName);
    return this.createTimer(TickEventNameEnums.TimerTriggered, delay, repeat, startAt, callbackEventName);
  }

  private createTimer(
    eventName: string,
    delay: number,
    repeat: number,
    startAt: number,
    args: JsonValue,
  ): ITickTimerHandle {
    const interval = Math.max(1, Math.ceil(delay / this.frameInterval));
    const firstInterval = startAt > 0
      ? Math.max(1, Math.ceil((delay - startAt) / this.frameInterval))
      : interval;

    const timer: EntityTimerRecord = {
      id: this.nextTimerId++,
      eventName,
      targetFrame: this.currentFrame + firstInterval,
      repeat,
      interval,
      group: this.ownerId,
      args: isLogicValue(args) ? args : null,
    };
    this.timers.set(timer.id, timer);
    const handle = new TickTimerHandle(
      timer.id, timer.targetFrame, timer.repeat, timer.interval, timer.group, this,
    );
    this.handles.set(timer.id, handle);
    return handle;
  }

  public update(): void {
    if (this.timers.size === 0) return;
    const due = [...this.timers.values()]
      .filter((timer) => this.currentFrame >= timer.targetFrame)
      .sort((a, b) => a.id - b.id);

    for (const timer of due) {
      if (!this.timers.has(timer.id)) continue;

      const handlerArgs: JsonValue = timer.eventName === TickEventNameEnums.TimerTriggered
        ? { eventName: timer.args }
        : timer.args;
      const eventName = timer.eventName === TickEventNameEnums.TimerTriggered
        ? TickEventNameEnums.TimerTriggered
        : (timer.eventName as TickEventNameEnums | string);

      this.sink.handleTickEvent(eventName, handlerArgs, timer.id);

      if (timer.repeat > 0) {
        timer.repeat -= 1;
      }
      if (timer.repeat < 0 || timer.repeat > 0) {
        timer.targetFrame = this.currentFrame + timer.interval;
        this.syncHandle(timer);
      } else {
        this.remove(timer.id);
      }
    }
  }

  private syncHandle(timer: EntityTimerRecord): void {
    const handle = this.handles.get(timer.id);
    if (!handle) return;
    handle.targetFrame = timer.targetFrame;
    handle.repeat = timer.repeat;
    handle.interval = timer.interval;
  }

  public remove(timerId: number): void {
    this.timers.delete(timerId);
    this.handles.delete(timerId);
  }

  public removeByEvent(eventName: TickEventNameEnums | string): number {
    const name = String(eventName);
    const ids: number[] = [];
    for (const timer of this.timers.values()) {
      if (timer.eventName === name) ids.push(timer.id);
    }
    for (const id of ids) this.remove(id);
    return ids.length;
  }

  public capture(): TimerState[] {
    return [...this.timers.values()]
      .map((timer) => ({
        id: timer.id,
        targetFrame: timer.targetFrame,
        repeat: timer.repeat,
        interval: timer.interval,
        group: timer.group,
        kind: timer.eventName,
        ...(timer.args !== null ? { args: timer.args } : {}),
      }))
      .sort((a, b) => a.id - b.id);
  }

  public restore(states: TimerState[], context: RestoreContext): void {
    this.currentFrame = Math.trunc(context.frameId);

    const snapshotIds = new Set(states.map((timer) => timer.id));
    for (const id of [...this.timers.keys()]) {
      if (!snapshotIds.has(id)) this.remove(id);
    }

    for (const state of states) {
      const eventName = state.kind ?? TickEventNameEnums.LogicTick;
      let args = state.args ?? null;
      const existing = this.timers.get(state.id);
      if (eventName === TickEventNameEnums.TimerTriggered) {
        // 快照里的 `callback:N` 只是源端本机回调注册表的句柄，跨进程重连后
        // 编号含义完全不同：直接沿用会调用到别的实体（或已销毁实体）的闭包，
        // 这正是重连后“恢复的植物定时器去执行别的实体逻辑”的根因。
        // 1) 本机同 id 计时器存在：实体重建时 onCreate 已重新注册，沿用其句柄；
        // 2) 句柄属于本实例（同进程回滚，即使计时器已触发删除）：沿用原句柄；
        // 3) 其余（跨进程且无法验证）一律丢弃，绝不跨实体误派发。
        if (existing && existing.eventName === TickEventNameEnums.TimerTriggered) {
          args = existing.args;
        } else if (typeof args !== "string" || !this.ownCallbackHandles.has(args)) {
          context.report.missing.push(`timer.callback:${state.id}`);
          continue;
        }
      }
      if (existing) {
        existing.eventName = eventName;
        existing.targetFrame = state.targetFrame;
        existing.repeat = state.repeat;
        existing.interval = state.interval;
        existing.group = state.group || this.ownerId;
        existing.args = args;
        const handle = this.handles.get(state.id);
        if (handle) {
          handle.targetFrame = state.targetFrame;
          handle.repeat = state.repeat;
          handle.interval = state.interval;
          handle.group = state.group || this.ownerId;
        }
        continue;
      }

      const record: EntityTimerRecord = {
        id: state.id,
        eventName,
        targetFrame: state.targetFrame,
        repeat: state.repeat,
        interval: state.interval,
        group: state.group || this.ownerId,
        args,
      };
      this.timers.set(record.id, record);
      this.handles.set(record.id, new TickTimerHandle(
        record.id, record.targetFrame, record.repeat, record.interval, record.group, this,
      ));
      context.report.restored.push(`timer:${eventName}`);
    }

    this.setNextTimerId(context.nextTimerId ?? Math.max(...states.map((timer) => timer.id + 1), 1));
  }

  public clear(): void {
    this.timers.clear();
    this.handles.clear();
    this.ownCallbackHandles.clear();
    this.nextTimerId = 1;
  }

  public dispose(): void {
    this.clear();
    managedTickManagers.delete(this);
  }
}

/** 由固定步长主循环调用；只驱动帧号，所有 timer 状态仍归各 LogicModel 所有。 */
export function updateAllTickManagers(frame: number, frameIntervalMs?: number): void {
  currentLogicFrame = Math.trunc(frame);
  authoritativeFrame = currentLogicFrame;
  if (typeof frameIntervalMs === "number" && frameIntervalMs > 0) {
    currentFrameInterval = frameIntervalMs;
  }
  // Set 的插入顺序会受实体重建/回滚影响；按稳定 ownerId 排序，
  // 保证同一逻辑帧内所有实体的 timer 触发顺序在两端一致。
  const managers = [...managedTickManagers].sort((a, b) => {
    const aId = a.getOwnerId();
    const bId = b.getOwnerId();
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
  for (const manager of managers) {
    manager.setFrame(frame, frameIntervalMs);
    manager.update();
  }
}

/** 新开一局时重置实体定时器时钟，避免沿用上一局的高帧号。 */
export function resetTickManagerClock(): void {
  currentLogicFrame = 0;
  authoritativeFrame = 0;
  pendingCreationFrame = null;
  currentFrameInterval = LEGACY_BALANCE_FRAME_INTERVAL_MS;
}

/** 网络层消费权威帧时调用；后续创建的实体以该帧为 timer 起点。 */
export function setAuthoritativeFrame(frame: number): void {
  if (!Number.isFinite(frame)) return;
  authoritativeFrame = Math.max(0, Math.trunc(frame));
}

/** 创建实体时使用的逻辑帧：优先取正在执行的操作帧。 */
export function getAuthoritativeFrame(): number {
  return pendingCreationFrame ?? authoritativeFrame;
}

/**
 * 在指定帧的上下文中执行 fn。DeferredManager 用它保证延迟创建/销毁
 * 与触发它们的逻辑帧一致，不受 flush 实际执行时刻影响。
 */
export function withTickFrame<T>(frame: number, fn: () => T): T {
  const previous = pendingCreationFrame;
  pendingCreationFrame = Number.isFinite(frame) ? Math.max(0, Math.trunc(frame)) : previous;
  try {
    return fn();
  } finally {
    pendingCreationFrame = previous;
  }
}
