/**
 * 一次性逻辑事件队列：把"发射音效 / 受击飘字 / 枪口特效"从 Model 的回调里剥离。
 *
 * Model 只 emit 纯数据 (frame, eventId, type, sourceId, data)；
 * Entity 在渲染帧末按 eventId 去重消费，回滚重演不会重复播放。
 * 队列本身参与 StateRegistry 快照，跨进程恢复后事件序号一致。
 */

import type { JsonValue } from "../SimulationState.ts";

export interface LogicEventRecord {
  frame: number;
  eventId: number;
  type: string;
  sourceId: string;
  data: JsonValue;
}

export interface LogicEventsSnapshot {
  frame: number;
  nextEventId: number;
  events: LogicEventRecord[];
}

export class LogicEventQueue {
  private frame = 0;
  private nextEventId = 1;
  private events: LogicEventRecord[] = [];

  public setFrame(frame: number): void {
    this.frame = Math.trunc(frame);
  }

  public get currentFrame(): number {
    return this.frame;
  }

  public emit(type: string, sourceId: string, data: JsonValue = null): LogicEventRecord {
    const event: LogicEventRecord = {
      frame: this.frame,
      eventId: this.nextEventId++,
      type,
      sourceId,
      data,
    };
    this.events.push(event);
    return event;
  }

  /** 消费 frame 之后、且 id 大于 afterEventId 的事件（渲染层按 id 去重）。 */
  public consume(afterEventId: number, sourceId?: string): LogicEventRecord[] {
    return this.events.filter(
      (event) => event.eventId > afterEventId
        && (sourceId === undefined || event.sourceId === sourceId),
    );
  }

  public all(): LogicEventRecord[] {
    return [...this.events];
  }

  /** 回滚后撤销目标帧产生的事件，并复原 id 序号。 */
  public rollbackTo(frame: number): void {
    this.events = this.events.filter((event) => event.frame <= frame);
    let maxId = 1;
    for (const event of this.events) maxId = Math.max(maxId, event.eventId + 1);
    this.nextEventId = maxId;
    this.frame = frame;
  }

  /** 已确认帧之前的事件不再需要，避免队列无限增长。 */
  public forgetBefore(frame: number): void {
    this.events = this.events.filter((event) => event.frame >= frame);
  }

  public snapshot(): LogicEventsSnapshot {
    return {
      frame: this.frame,
      nextEventId: this.nextEventId,
      events: this.events.map((event) => ({ ...event })),
    };
  }

  public restore(snapshot: LogicEventsSnapshot): void {
    this.frame = snapshot.frame;
    this.nextEventId = snapshot.nextEventId;
    this.events = snapshot.events.map((event) => ({ ...event }));
  }

  /** 跨局清空：事件队列进入模拟哈希，旧局残留会让新局第一帧就分叉。 */
  public reset(): void {
    this.frame = 0;
    this.nextEventId = 1;
    this.events = [];
  }
}

export const logicEvents = new LogicEventQueue();
