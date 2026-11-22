/**
 * 帧定时器事件定义。
 *
 * 定时器本体只保存 (ownerId, eventName, TriggerFrame)，不保存任何函数。
 * 到点后由 LogicModel.handleTickEvent 按事件名派发，回调通过稳定的事件注册表解析，
 * 因此回滚/重建不会创建新的函数对象，也不会产生“幽灵回调”。
 */

export const TickEventNameEnums = {
  /** 兼容旧式 callback 注册：详情在 args.eventName 中。 */
  TimerTriggered: "TimerTriggered",
  /** 逻辑帧推进（可用于状态驱动帧计数）。 */
  LogicTick: "LogicTick",
  /** 投射物生命周期结束：爆炸/激光等按纯数据 timer 销毁。 */
  ProjectileExpire: "ProjectileExpire",
  /** 植物表现帧复位：随 Model 快照回滚，避免 scene.time 产生幽灵表现。 */
  GeneratorResetVisualFrame: "GeneratorResetVisualFrame",
  /** 魅惑到期：Model 在到期帧清除 charmedBy 并按新阵营重选目标。 */
  CharmExpired: "CharmExpired",
} as const;

export type TickEventNameEnums = typeof TickEventNameEnums[keyof typeof TickEventNameEnums];

export const DEFAULT_TICK_EVENT_NAMES: readonly TickEventNameEnums[] = [
  TickEventNameEnums.LogicTick,
  TickEventNameEnums.TimerTriggered,
  TickEventNameEnums.CharmExpired,
];

type CallbackBinding = {
  callback: (...args: any[]) => void;
  args: any[];
  context: any;
};

const callbackToEvent = new WeakMap<Function, string>();
const eventToBinding = new Map<string, CallbackBinding>();
let nextEventId = 1;

/** 把业务回调登记为稳定的事件名。回调只存在此注册表中，不进入 timer 状态。 */
export function registerTickEventCallback(
  callback: (...args: any[]) => void,
  args: any[] = [],
  context: any = null,
): string {
  if (typeof callback !== "function") {
    return TickEventNameEnums.LogicTick;
  }
  let eventName = callbackToEvent.get(callback);
  if (!eventName) {
    eventName = `callback:${nextEventId++}`;
    callbackToEvent.set(callback, eventName);
    eventToBinding.set(eventName, { callback, args, context });
  }
  return eventName;
}

/** LogicModel.HandleTickEvent 用来解析并执行回调；不会重新创建函数。 */
export function invokeTickEventCallback(eventName: string): boolean {
  const binding = eventToBinding.get(eventName);
  if (!binding) return false;
  binding.callback.apply(binding.context, binding.args);
  return true;
}

export function hasTickEventCallback(eventName: string): boolean {
  return eventToBinding.has(eventName);
}
