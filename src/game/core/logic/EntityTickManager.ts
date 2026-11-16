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

export class EntityTickManager implements ITickManagerProxy {
  public currentFrame = currentLogicFrame;
  public frameInterval = currentFrameInterval;

  private ownerId = "entity";
  private nextTimerId = 1;
  private readonly timers = new Map<number, EntityTimerRecord>();
  private readonly handles = new Map<number, TickTimerHandle>();

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
      const args = state.args ?? null;
      const existing = this.timers.get(state.id);
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
  if (typeof frameIntervalMs === "number" && frameIntervalMs > 0) {
    currentFrameInterval = frameIntervalMs;
  }
  for (const manager of managedTickManagers) {
    manager.setFrame(frame, frameIntervalMs);
    manager.update();
  }
}

/** 新开一局时重置实体定时器时钟，避免沿用上一局的高帧号。 */
export function resetTickManagerClock(): void {
  currentLogicFrame = 0;
  currentFrameInterval = LEGACY_BALANCE_FRAME_INTERVAL_MS;
}
