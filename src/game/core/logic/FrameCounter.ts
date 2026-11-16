/**
 * 帧号状态机：用普通整数替代带回调的定时器。
 *
 * 没有函数指针、没有闭包、没有委托列表；所有状态都是 LogicState 里的数字，
 * 因此随快照一起回滚，重演时不会触发"幽灵回调"。
 */

export interface FrameSchedule {
  /** 下一次触发的逻辑帧号。 */
  nextFrame: number;
  /** 触发间隔（帧），必须 >= 1。 */
  interval: number;
  /** 剩余触发次数；负数表示无限。 */
  repeat: number;
}

/** 创建一个从 frame + delay 起触发的调度状态（纯数据）。 */
export function makeSchedule(frame: number, delayFrames: number, repeat = 0, intervalFrames = delayFrames): FrameSchedule {
  const interval = Math.max(1, Math.trunc(intervalFrames || delayFrames));
  return {
    nextFrame: frame + Math.max(1, Math.trunc(delayFrames)),
    interval,
    repeat,
  };
}

/** 是否到期；不修改状态。 */
export function isDue(schedule: FrameSchedule, frame: number): boolean {
  return schedule.nextFrame <= frame && schedule.repeat !== 0;
}

/**
 * 消费一次到期调度：推进到下一帧号并递减 repeat。
 * 用 while 推进而不是 `frame + interval`，保证长帧跳跃后触发次数确定且不会漂移。
 */
export function consumeDue(schedule: FrameSchedule, frame: number): boolean {
  if (!isDue(schedule, frame)) return false;
  do {
    schedule.nextFrame += schedule.interval;
    if (schedule.repeat > 0) schedule.repeat -= 1;
  } while (schedule.nextFrame <= frame && schedule.repeat !== 0);
  return true;
}

/** 剩余冷却帧数（供表现层读取，不参与判定）。 */
export function remainingFrames(targetFrame: number, frame: number): number {
  return Math.max(0, targetFrame - frame);
}

/** 设置冷却结束帧。 */
export function startCooldown(frame: number, durationFrames: number): number {
  return frame + Math.max(0, Math.trunc(durationFrames));
}

/** 冷却是否结束。 */
export function cooldownReady(targetFrame: number, frame: number): boolean {
  return frame >= targetFrame;
}
