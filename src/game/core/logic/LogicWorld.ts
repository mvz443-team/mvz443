/**
 * 确定性逻辑世界：Model 的唯一运行时容器。
 *
 * 与旧机制的区别：
 * - 不用 EntityID 之外的对象引用；实体只通过字符串 id 互相关联。
 * - spawn/destroy 进入 Undo Log；回滚后"从未出生过"的实体连同 id 序号一起撤销。
 * - 一次性表现事件带 (frame, eventId)，渲染层按 id 去重，重演不会鬼畜。
 * - 不依赖 Phaser / Rapier，可在 Node 下直接测试与快照。
 */

import {
  createLogicState,
  getLogicHandle,
  type LogicValue,
  type Tracked,
} from "./LogicState.ts";

export const LOGIC_WORLD_SNAPSHOT_VERSION = 1;
const WORLD_SNAPSHOT_VERSION = LOGIC_WORLD_SNAPSHOT_VERSION;

export interface LogicEntity<T extends object = Record<string, unknown>> {
  readonly id: string;
  readonly generation: number;
  readonly kind: string;
  readonly state: Tracked<T>;
  alive: boolean;
}

export interface LogicEvent {
  readonly frame: number;
  readonly eventId: number;
  readonly type: string;
  readonly sourceId: string;
  readonly data: LogicValue;
}

export interface LogicWorldSnapshot {
  version: number;
  frame: number;
  nextGeneration: number;
  nextEventId: number;
  entities: Array<{
    id: string;
    generation: number;
    kind: string;
    state: LogicValue;
    alive: boolean;
  }>;
  events: LogicEvent[];
}

type UndoEntry =
  | { kind: "spawn"; id: string }
  | { kind: "destroy"; id: string }
  | { kind: "counter"; key: "nextGeneration" | "nextEventId"; oldValue: number }
  | { kind: "event"; eventId: number };

export class LogicWorld {
  public frame = 0;

  private readonly entities = new Map<string, LogicEntity>();
  private nextGeneration = 1;
  private nextEventId = 1;
  private readonly events: LogicEvent[] = [];
  private readonly undoLogs = new Map<number, UndoEntry[]>();

  private record(entry: UndoEntry): void {
    let log = this.undoLogs.get(this.frame);
    if (!log) {
      log = [];
      this.undoLogs.set(this.frame, log);
    }
    log.push(entry);
  }

  private recordCounter(key: "nextGeneration" | "nextEventId"): void {
    const oldValue = key === "nextGeneration" ? this.nextGeneration : this.nextEventId;
    if (!this.undoLogs.get(this.frame)?.some((e) => e.kind === "counter" && e.key === key)) {
      this.record({ kind: "counter", key, oldValue });
    }
  }

  /** 推进一帧，并把帧号同步给所有状态对象。 */
  public step(fn?: (world: LogicWorld, frame: number) => void): number {
    this.frame += 1;
    this.syncStateFrames();
    fn?.(this, this.frame);
    return this.frame;
  }

  public setFrame(frame: number): void {
    this.frame = Math.trunc(frame);
    this.syncStateFrames();
  }

  private syncStateFrames(): void {
    for (const entity of this.entities.values()) {
      getLogicHandle(entity.state)?.setFrame(this.frame);
    }
  }

  /**
   * 创建实体；默认 id 由递增 generation 组成。
   * 允许显式 id（例如 plant:col:row:pid），generation 仍然递增，
   * 因此回滚后重建的 id 序列与原始时间线完全一致。
   */
  public spawn<T extends object>(kind: string, initial: T, explicitId?: string): LogicEntity<T> {
    this.recordCounter("nextGeneration");
    const generation = this.nextGeneration++;
    const id = explicitId ?? `${kind}:${generation}`;
    const state = createLogicState(initial, this.frame);
    const entity: LogicEntity<T> = { id, generation, kind, state, alive: true };
    this.entities.set(id, entity as LogicEntity);
    this.record({ kind: "spawn", id });
    return entity;
  }

  public destroy(id: string): boolean {
    const entity = this.entities.get(id);
    if (!entity?.alive) return false;
    entity.alive = false;
    this.record({ kind: "destroy", id });
    return true;
  }

  public get<T extends object>(id: string): LogicEntity<T> | undefined {
    const entity = this.entities.get(id);
    return entity?.alive ? (entity as LogicEntity<T>) : undefined;
  }

  /** 按插入顺序返回存活实体；需要稳定哈希时调用方按 id 排序。 */
  public active<T extends object>(kind?: string): LogicEntity<T>[] {
    const out: LogicEntity<T>[] = [];
    for (const entity of this.entities.values()) {
      if (entity.alive && (kind === undefined || entity.kind === kind)) {
        out.push(entity as LogicEntity<T>);
      }
    }
    return out;
  }

  /** 派发一次性表现事件（逻辑层只记录，不播放）。 */
  public emit(type: string, sourceId: string, data: LogicValue = null): LogicEvent {
    this.recordCounter("nextEventId");
    const event: LogicEvent = {
      frame: this.frame,
      eventId: this.nextEventId++,
      type,
      sourceId,
      data,
    };
    this.events.push(event);
    this.record({ kind: "event", eventId: event.eventId });
    return event;
  }

  /** 渲染层按 eventId 去重后消费；回滚时超过目标帧的事件会一并撤销。 */
  public eventsAfter(frame: number, sourceId?: string): LogicEvent[] {
    return this.events.filter(
      (event) => event.frame > frame && (sourceId === undefined || event.sourceId === sourceId),
    );
  }

  public allEvents(): LogicEvent[] {
    return [...this.events];
  }

  public clearEvents(): void {
    this.events.length = 0;
  }

  /** 全量快照：实体 id / generation / 状态 / 事件 / 计数器完整保存。 */
  public capture(): LogicWorldSnapshot {
    const entityStates = [...this.entities.values()]
      .map((entity) => ({
        id: entity.id,
        generation: entity.generation,
        kind: entity.kind,
        state: getLogicHandle(entity.state)!.snapshot() as LogicValue,
        alive: entity.alive,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    return {
      version: WORLD_SNAPSHOT_VERSION,
      frame: this.frame,
      nextGeneration: this.nextGeneration,
      nextEventId: this.nextEventId,
      entities: entityStates,
      events: this.events.map((event) => ({ ...event })),
    };
  }

  public restore(snapshot: LogicWorldSnapshot): void {
    if (snapshot.version !== WORLD_SNAPSHOT_VERSION) {
      throw new Error(`不支持的逻辑世界快照版本: ${snapshot.version}`);
    }
    this.entities.clear();
    for (const item of snapshot.entities) {
      const state = createLogicState(item.state as Record<string, unknown>, snapshot.frame);
      this.entities.set(item.id, {
        id: item.id,
        generation: item.generation,
        kind: item.kind,
        state,
        alive: item.alive,
      });
    }
    this.events.length = 0;
    for (const event of snapshot.events) this.events.push({ ...event });
    this.frame = snapshot.frame;
    this.nextGeneration = snapshot.nextGeneration;
    this.nextEventId = snapshot.nextEventId;
    this.undoLogs.clear();
  }

  /**
   * 回滚到目标帧。撤销目标帧之后的状态写入、实体生命周期、事件与计数器，
   * 使后续重放得到与从未预测过完全一致的 id 序列。
   */
  public rollbackTo(targetFrame: number): void {
    const frames = [...this.undoLogs.keys()].filter((f) => f > targetFrame).sort((a, b) => b - a);
    for (const frame of frames) {
      const entries = this.undoLogs.get(frame)!;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        switch (entry.kind) {
          case "spawn":
            this.entities.delete(entry.id);
            break;
          case "destroy": {
            const entity = this.entities.get(entry.id);
            if (entity) entity.alive = true;
            break;
          }
          case "counter":
            if (entry.key === "nextGeneration") this.nextGeneration = entry.oldValue;
            else this.nextEventId = entry.oldValue;
            break;
          case "event": {
            const index = this.events.findIndex((event) => event.eventId === entry.eventId);
            if (index >= 0) this.events.splice(index, 1);
            break;
          }
        }
      }
      this.undoLogs.delete(frame);
    }

    for (const entity of this.entities.values()) {
      const handle = getLogicHandle(entity.state);
      if (handle && handle.frame > targetFrame) handle.rollbackTo(targetFrame);
      else handle?.setFrame(targetFrame);
    }

    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].frame > targetFrame) this.events.splice(i, 1);
    }
    this.frame = targetFrame;
    this.syncStateFrames();
  }

  /** 丢弃 Undo 历史（例如服务器确认帧之后），保留当前状态。 */
  public forgetHistory(beforeFrame: number): void {
    for (const frame of [...this.undoLogs.keys()]) {
      if (frame < beforeFrame) this.undoLogs.delete(frame);
    }
    for (const entity of this.entities.values()) {
      getLogicHandle(entity.state)?.forgetFramesBefore(beforeFrame);
    }
  }

  public get historyFrames(): number[] {
    return [...this.undoLogs.keys()].sort((a, b) => a - b);
  }

  /** 供 StateRegistry 使用：把实体状态转换为 EntityLogicState 兼容的 flags。 */
  public captureLogicFlags(): Record<string, LogicValue> {
    const out: Record<string, LogicValue> = {};
    for (const entity of [...this.entities.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      out[entity.id] = {
        kind: entity.kind,
        alive: entity.alive,
        state: getLogicHandle(entity.state)!.snapshot() as LogicValue,
      };
    }
    return out;
  }
}
