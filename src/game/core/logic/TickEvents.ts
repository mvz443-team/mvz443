/**
 * 帧定时器事件定义。
 *
 * 定时器本体只保存 (ownerId, TickEventNameEnums, TriggerFrame)，不保存任何函数。
 * 到点后由 LogicModel.HandleTickEvent 按枚举派发，回调通过稳定的事件注册表解析，
 * 因此回滚/重建不会创建新的函数对象，也不会产生“幽灵回调”。
 */

export const TickEventNameEnums = {
  /** 兼容旧式 callback 注册：详情在 args.eventName 中。 */
  TimerTriggered: "TimerTriggered",
  /** 逻辑帧推进（可用于状态驱动帧计数）。 */
  LogicTick: "LogicTick",
  /** 实体自定义事件的起始值；业务可用字符串枚举值。 */
  Custom: "Custom",

  /** 怪物普攻命中。 */
  MonsterAttack: "MonsterAttack",
  /** 骨架弓手射击与恢复移动。 */
  SkeletonBowShoot: "SkeletonBowShoot",
  SkeletonBowResume: "SkeletonBowResume",
  /** Evoker 召唤 vindicator。 */
  EvokerSummon: "EvokerSummon",
  /** Evoker 结束召唤姿态。 */
  EvokerResume: "EvokerResume",
  /** 龟壳破碎后的连续发箭。 */
  TurtleShellBurst: "TurtleShellBurst",
  /** Mutant 砸击后的恢复窗口结束。 */
  MutantRecover: "MutantRecover",
  /** Golem 技能循环阶段。 */
  GolemBegin: "GolemBegin",
  GolemCast: "GolemCast",
  GolemArmStop: "GolemArmStop",
  GolemReposition: "GolemReposition",
  GolemSummonNext: "GolemSummonNext",
  WardenLand: "WardenLand",
  WardenReposition: "WardenReposition",
  ObsidianColumn: "ObsidianColumn",
  ObsidianObstacleSpawn: "ObsidianObstacleSpawn",
  ObsidianReposition: "ObsidianReposition",
  /** 蜈蚣技能循环阶段。 */
  CentipedeSpawn: "CentipedeSpawn",
  CentipedeCycle: "CentipedeCycle",
  CentipedeDisappear: "CentipedeDisappear",
  CentipedeSkillStep: "CentipedeSkillStep",
  CentipedeRockImpact: "CentipedeRockImpact",
  CentipedeSummonSfx: "CentipedeSummonSfx",
  CentipedeSpawnMinion: "CentipedeSpawnMinion",
  CentipedeBlastImpact: "CentipedeBlastImpact",
} as const;

export type TickEventNameEnums = typeof TickEventNameEnums[keyof typeof TickEventNameEnums];

export const DEFAULT_TICK_EVENT_NAMES: readonly TickEventNameEnums[] = [
  TickEventNameEnums.LogicTick,
  TickEventNameEnums.TimerTriggered,
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
