import { LEGACY_BALANCE_FRAME_INTERVAL_MS } from "../../../constants/physics";
import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import { BaseManager } from "../BaseManager";
import type { JsonValue, RestoreContext, TimerState } from "../../core/SimulationState";
import { resetTickManagerClock } from "../../core/logic/EntityTickManager";

export function timerToState(timer: FrameTimer): TimerState {
  return {
    id: timer.id,
    targetFrame: timer.targetFrame,
    repeat: timer.repeat,
    interval: timer.interval,
    group: timer.group,
    ...(timer.snapshotKind !== undefined ? { kind: timer.snapshotKind } : {}),
    ...(timer.snapshotArgs !== undefined ? { args: timer.snapshotArgs } : {}),
  };
}

/** 可重建计时器的回调工厂：用纯数据参数重建闭包。 */
export type TimerFactory = (args: JsonValue, group: string) => {
  callback: (...args: any[]) => void;
  args?: any[];
  context?: any;
} | null;

export class FrameTimer {
  public id: number = 0;        // 定时器唯一ID

  public targetFrame: number = 0; // 目标帧数（到达此帧时执行回调）
  public callback: (...args: any[]) => void;  // 定时回调函数
  public args: any[];                // 参数数组
  public context: any;               // 执行回调时的上下文
  public repeat: number;             // 重复次数：0表示一次性，正数表示剩余重复次数，-1表示无限重复
  public interval: number;           // 循环定时任务的帧间隔

  public group: string;
  /** 可重建语义类型 / 参数；仅在需要跨会话重建时设置。 */
  public snapshotKind?: string;
  public snapshotArgs?: JsonValue;
  /** 纯表现 timer：不进入跨端快照/哈希，也不消耗确定性 timer id。 */
  public localOnly: boolean;
  private ticker: TickerManager;

  constructor(options: {
    id: number;
    targetFrame: number;
    callback: (...args: any[]) => void;
    args: any[];
    context: any;
    repeat: number;
    interval: number;
    group: string;
    ticker: TickerManager;
    snapshotKind?: string;
    snapshotArgs?: JsonValue;
    localOnly?: boolean;
  }) {
    this.id = options.id;
    this.targetFrame = options.targetFrame;
    this.callback = options.callback;
    this.args = options.args;
    this.context = options.context;
    this.repeat = options.repeat;
    this.interval = options.interval;
    this.group = options.group;
    this.ticker = options.ticker;
    this.snapshotKind = options.snapshotKind;
    this.snapshotArgs = options.snapshotArgs;
    this.localOnly = options.localOnly ?? false;
  }

  // 计算剩余时间(frame)
  public GetLeftTimeByFrame(): number {
    return this.targetFrame - this.ticker.currentFrame;
  }

  // 计算剩余时间（毫秒）
  public GetLeftTimeByMs(): number {
    return this.GetLeftTimeByFrame() * this.ticker.frameInterval;
  }

  public remove(): void {
    this.ticker.Unregister(this);
  }
}

export interface TimerSnapshotTag {
  kind: string;
  args?: JsonValue;
}

export type DelayedCallConfigType = {
  callback: (...args: any[]) => void;
  delay: number;
  args?: any[];
  context?: any;
  group?: string;
  /** 需要跨会话重建时提供语义描述。 */
  snapshot?: TimerSnapshotTag;
  localOnly?: boolean;
};

export type AddEventConfigType = {
  callback: (...args: any[]) => void;
  delay: number;
  args?: any[];
  context?: any;
  repeat?: number;
  startAt?: number;
  loop?: boolean;
  group?: string;
  snapshot?: TimerSnapshotTag;
  localOnly?: boolean;
};

export default class TickerManager extends BaseManager {
  private static _instance: TickerManager;

  public readonly frameInterval: number = LEGACY_BALANCE_FRAME_INTERVAL_MS;
  public currentFrame: number = 0;

  private timers: Map<number, FrameTimer> = new Map();
  private nextTimerId: number = 1;
  /** 纯表现 timer 使用独立 id 命名空间，避免污染确定性 timer id。 */
  private nextLocalTimerId: number = -1;
  private startTime: number = 0;
  private readonly timerFactories = new Map<string, TimerFactory>();

  constructor() {
    super();
  }

  public Load(): void {
    PhaserEventBus.on(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
  }

  public static get Instance(): TickerManager {
    if (!this._instance) {
      this._instance = new TickerManager();
    }
    return this._instance;
  }

  private handleRoomGameStart() {
    this.initStart();
  }

  /**
   * 初始化开始时间
   */
  public initStart(): void {
    this.startTime = Date.now();
  }

  /**
   * 获取当前时间
   */
  public getCurrentTime(): number {
    return this.startTime + this.currentFrame * this.frameInterval;
  }

  /**
   * 计算两个 tick 之间的真实毫秒数
   * @param tick1 第一个 tick 值
   * @param tick2 第二个 tick 值
   * @returns 两个 tick 之间的毫秒数（绝对值）
   */
  public calcTickDeltaMs(tick1: number, tick2: number): number {
    return Math.abs(tick2 - tick1) * this.frameInterval;
  }

  public getCurrentFrame(): number {
    return this.currentFrame;
  }

  /**
   * 注册一个定时器
   * @param callback 定时触发的回调函数
   * @param delay 延迟的时间（毫秒）
   * @param args 回调的参数
   * @param context 回调函数执行时的上下文
   * @param repeat 重复次数，0为一次性，-1为无限重复，正数为重复次数
   * @param group 分组Key
   */
  public Register(
    callback: (...args: any[]) => void,
    delay: number,
    args: any[] = [],
    context: any = null,
    repeat: number = 0,
    group: string = 'default',
    snapshot?: TimerSnapshotTag,
    localOnly: boolean = false,
  ): FrameTimer {
    const frameDelay = Math.ceil(delay / this.frameInterval);
    const targetFrame = this.currentFrame + frameDelay;

    const timer: FrameTimer = new FrameTimer({
      id: localOnly ? this.nextLocalTimerId-- : this.nextTimerId++,
      targetFrame: targetFrame,
      callback: callback,
      args: args,
      context: context,
      repeat: repeat,
      interval: frameDelay,
      group: group,
      ticker: this,
      snapshotKind: snapshot?.kind,
      snapshotArgs: snapshot?.args,
      localOnly,
    });

    this.timers.set(timer.id, timer);
    return timer;
  }

  /** 注册可重建计时器的工厂。重复注册会覆盖。 */
  public registerTimerFactory(kind: string, factory: TimerFactory): void {
    this.timerFactories.set(kind, factory);
  }

  public getNextTimerId(): number {
    return this.nextTimerId;
  }

  public setNextTimerId(nextTimerId: number): void {
    this.nextTimerId = Math.max(1, nextTimerId);
  }

  /** 导出当前全部计时器（用于诊断/测试）。 */
  public getTimers(): readonly FrameTimer[] {
    return [...this.timers.values()];
  }

  /**
   * 按快照语义查找计时器。
   *
   * checkpoint rebuild 会重建 FrameTimer 对象；管理器里缓存的旧句柄
   * 仍然持有相同的 id，直接调用 remove() 可能误删重建后的新 timer。
   * 需要取消某类全局逻辑 timer 时，必须按 kind 查找当前实例。
   */
  public getTimersByKind(kind: string): FrameTimer[] {
    return [...this.timers.values()]
      .filter((timer) => timer.snapshotKind === kind)
      .sort((a, b) => a.id - b.id);
  }

  /** 取消指定语义类型的全部计时器，返回取消数量。 */
  public removeTimersByKind(kind: string): number {
    let removed = 0;
    for (const timer of [...this.timers.values()]) {
      if (timer.snapshotKind !== kind) continue;
      this.timers.delete(timer.id);
      removed++;
    }
    return removed;
  }

  /** 把某个 group 的计时器整体迁移到新的稳定 key（实体重建时使用）。 */
  public RenameGroup(oldGroup: string, newGroup: string): void {
    if (oldGroup === newGroup) return;
    this.timers.forEach((timer) => {
      if (timer.group === oldGroup) timer.group = newGroup;
    });
  }

  /**
   * 注销定时器
   * @param timer 要注销的定时器对象
   */
  public Unregister(timer: FrameTimer): void {
    this.timers.delete(timer.id);
  }

  /**
   * 一次性延迟调用
   * @param config 配置对象
   */
  public delayedCall(config: DelayedCallConfigType): FrameTimer {
    const {
      callback,
      delay,
      args = [],
      context = null,
      group = 'default',
      snapshot,
      localOnly = false,
    } = config;
    return this.Register(callback, delay, args, context, 0, group, snapshot, localOnly);
  }

  /**
   * 添加循环定时事件
   * @param config 配置对象
   */
  public addEvent(config: AddEventConfigType): FrameTimer {
    const {
      callback,
      delay,
      startAt = 0,
      args = [],
      context = null,
      repeat = -1,
      loop = false,
      group = 'default',
      snapshot,
      localOnly = false,
    } = config;

    const finalRepeat = loop ? -1 : repeat;

    if (startAt > 0) {
      const firstDelayMs = delay - startAt;

      const ret = this.Register(
        () => {
          const leftRepeat = finalRepeat - 1;
          const originalID = ret.id;
          const timer = this.timers.get(originalID);
          if (!timer) return;

          timer.repeat = leftRepeat;

          const frameDelay = Math.ceil(delay / this.frameInterval);
          const targetFrame = this.currentFrame + frameDelay;

          timer.targetFrame = targetFrame;
          timer.interval = frameDelay;
          timer.callback = callback;

          callback.apply(context, args);
        },
        firstDelayMs,
        args,
        context,
        1,
        group,
        snapshot,
        localOnly,
      );

      return ret;
    } else {
      return this.Register(callback, delay, args, context, finalRepeat, group, snapshot, localOnly);
    }
  }

  /**
   * 每帧的更新调用（需要在游戏帧循环中调用此方法）
   */
  public Update(): void {
    this.currentFrame++;

    // Map 的插入顺序会受实体重建/回滚影响；同一逻辑帧的定时器触发
    // 顺序必须由稳定 id 决定，否则两端同一时刻注册的 timer 可能以
    // 不同顺序执行，产生不同的世界变更。
    const due = [...this.timers.values()]
      .filter((timer) => this.currentFrame >= timer.targetFrame)
      .sort((a, b) => a.id - b.id);
    const timersToRemove: number[] = [];
    for (const timer of due) {
      // 前一个 timer 的回调可能已经移除了当前 timer。
      if (!this.timers.has(timer.id)) continue;
      timer.callback.apply(timer.context, timer.args);

      if (timer.repeat < 0 || timer.repeat > 0) {
        if (timer.repeat > 0) {
          timer.repeat--;
        }
        timer.targetFrame = this.currentFrame + timer.interval;
      } else {
        timersToRemove.push(timer.id);
      }
    }

    timersToRemove.forEach((id) => {
      this.timers.delete(id);
    });
  }

  /**
   * 删除整个组的所有计时器
   * @param group 分组Key
   */
  public RemoveGroup(group: string): void {
    const timersToRemove: number[] = [];
    this.timers.forEach((timer, id) => {
      if (timer.group === group) {
        timersToRemove.push(id);
      }
    });
    timersToRemove.forEach((id) => {
      this.timers.delete(id);
    });
  }

  /**
   * 导出全部定时器的确定性字段，供状态哈希与快照使用。
   * 回调/context 不入快照：它们由业务对象持有，恢复时按 id 就地更新即可。
   */
  public GetTimerStates(): TimerState[] {
    const states: TimerState[] = [];
    this.timers.forEach((timer) => {
      if (timer.localOnly) return;
      states.push(timerToState(timer));
    });
    return states.sort((a, b) => a.id - b.id);
  }

  /**
   * 恢复计时器。
   * - in-place：删除快照之后新增的计时器，并把存活计时器回退到快照帧；
   * - rebuild：清空后按 kind/args 通过工厂重建。
   */
  public RestoreTimerStates(states: TimerState[], context: RestoreContext): void {
    this.currentFrame = context.frameId;

    if (context.mode === "rebuild") {
      this.timers.clear();
      for (const snapshot of states) {
        if (!this.rebuildTimer(snapshot, context)) {
          context.report.missing.push(`timer:${snapshot.id}(${snapshot.kind ?? "untagged"})`);
        }
      }
      // 精确回退到快照值：使用 max 会让回滚后新建 timer 拿到与未回滚分支
      // 不同的 id，随后 timer 顺序与事件顺序都会分叉。
      this.nextTimerId = context.nextTimerId
        ?? Math.max(...states.map((timer) => timer.id + 1), 1);
      return;
    }

    const snapshotIds = new Set(states.map((timer) => timer.id));
    // 关键：回滚必须删除“快照之后才创建”的计时器，否则会重复触发。
    for (const id of [...this.timers.keys()]) {
      const timer = this.timers.get(id);
      if (timer?.localOnly) continue;
      if (!snapshotIds.has(id)) this.timers.delete(id);
    }

    for (const snapshot of states) {
      const timer = this.timers.get(snapshot.id);
      if (timer) {
        timer.targetFrame = snapshot.targetFrame;
        timer.repeat = snapshot.repeat;
        timer.interval = snapshot.interval;
        timer.group = snapshot.group;
        timer.snapshotKind = snapshot.kind;
        timer.snapshotArgs = snapshot.args;
        continue;
      }
      if (!this.rebuildTimer(snapshot, context)) {
        context.report.missing.push(`timer:${snapshot.id}(${snapshot.kind ?? "untagged"})`);
      }
    }

    this.nextTimerId = context.nextTimerId
      ?? Math.max(...states.map((timer) => timer.id + 1), 1);
  }

  private rebuildTimer(snapshot: TimerState, context: RestoreContext): boolean {
    if (!snapshot.kind) return false;
    const factory = this.timerFactories.get(snapshot.kind);
    if (!factory) return false;

    const built = factory(snapshot.args ?? null, snapshot.group);
    if (!built) return false;

    const timer = new FrameTimer({
      id: snapshot.id,
      targetFrame: snapshot.targetFrame,
      callback: built.callback,
      args: built.args ?? [],
      context: built.context ?? null,
      repeat: snapshot.repeat,
      interval: snapshot.interval,
      group: snapshot.group,
      ticker: this,
      snapshotKind: snapshot.kind,
      snapshotArgs: snapshot.args,
    });
    this.timers.set(timer.id, timer);
    context.report.restored.push(`timer.rebuilt:${snapshot.kind}`);
    return true;
  }

  /**
   * 清空所有计时器
   */
  public Reset(): void {
    resetTickManagerClock();
    PhaserEventBus.off(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    this.timers.clear();
    // 工厂在每局 Load() 时重新注册；跨局残留会让 checkpoint 重建出上一局
    // 才有的 timer kind，因此这里一并清空。
    this.timerFactories.clear();
    this.nextTimerId = 1;
    this.nextLocalTimerId = -1;
    this.currentFrame = 0;
    this.startTime = 0;
  }
}

// 定时器代理类：自动将 group 绑定到实体的 TimerKey
export class TickerManagerProxy {
  constructor(private timerKey: string) { }

  public delayedCall(config: Omit<DelayedCallConfigType, "group">): FrameTimer {
    return TickerManager.Instance.delayedCall({
      ...config,
      group: this.timerKey,
    });
  }

  public addEvent(config: Omit<AddEventConfigType, "group">): FrameTimer {
    return TickerManager.Instance.addEvent({
      ...config,
      group: this.timerKey,
    });
  }

  public Register(
    callback: (...args: any[]) => void,
    delay: number,
    args: any[] = [],
    context: any = null,
    repeat: number = 0,
    snapshot?: TimerSnapshotTag
  ): FrameTimer {
    return TickerManager.Instance.Register(
      callback,
      delay,
      args,
      context,
      repeat,
      this.timerKey,
      snapshot
    );
  }
}
