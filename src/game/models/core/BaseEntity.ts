import uniqueId from "lodash/uniqueId";
import type { Game } from "../../scenes/Game";
import RAPIER, { Vector } from "@dimforge/rapier2d-deterministic-compat";
import { CollisionContext } from "../../types";
import { DeferredManager } from "../../managers/DeferredManager";
import { PositionManager } from "../../managers/view/PositionManager";
import type { EntityLogicState, JsonValue } from "../../core/SimulationState";
import type { RestoreContext, Restorable } from "../../core/Restorable";
import { logicEvents, type LogicEventRecord } from "../../core/logic/LogicEvents";
import {
  LogicModel,
  attachModelAccessors,
  cloneLogicModel,
  restoreModel,
  snapshotModel,
  setModelFrame,
  type ModelHost,
} from "../../core/logic/LogicModel";
import {
  capturePrngs,
  captureRelations,
  restorePrngs,
  restoreRelations,
} from "../../core/EntitySnapshot";
import { forgetRigidBody, rememberRigidBody } from "../../core/PhysicsSnapshot";

const NO_RELATION_FIELDS: readonly string[] = [];

// Entity 只负责视图与物理胶水；确定性状态与战斗逻辑全部在 Model。
export abstract class BaseEntity implements Restorable<EntityLogicState>, ModelHost {
  /** Model 字段在运行时通过访问器挂到实体上，TS 侧用索引签名兼容。 */
  [key: string]: any;
  public scene: Game;
  public x: number;
  public y: number;

  public abstract baseDepth: number;
  private snapshotKeyId: string = "";
  public get SnapshotId(): string { return this.snapshotKeyId; }
  public get id(): string { return this.SnapshotId; }
  public get snapshotKey(): string { return this.snapshotKeyId; }
  public get IsAlive(): boolean { return !this.isDestroyQueued && !this.isDestroyed; }

  /** 稳定快照 id，同时作为 Model 定时器的 owner 标签；与全局 timer group 无关。 */
  public adoptStableSnapshotKey(key: string): void {
    if (!key || key === this.snapshotKeyId) return;
    this.snapshotKeyId = key;
    this.model?.setTickOwnerId(key);
  }

  /** @deprecated 使用 adoptStableSnapshotKey；实体已不持有 TimerKey。 */
  public adoptStableTimerKey(key: string): void {
    this.adoptStableSnapshotKey(key);
  }

  public rigidBody: RAPIER.RigidBody | null = null;
  public viewGroup: Phaser.GameObjects.Group;
  private isDestroyQueued = false;
  private isDestroyed = false;

  /** 唯一参与快照的对象。 */
  public readonly model: LogicModel | null;
  private modelBound = false;
  private lastConsumedEventId = 0;

  constructor(scene: Game, x: number, y: number, model: LogicModel | null = null) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.viewGroup = scene.add.group();
    this.snapshotKeyId = uniqueId("entity_");
    // 每个实体持有独立 Model 副本；Library 里的实例只当模板。
    this.model = model ? cloneLogicModel(model) : null;
    if (this.model) {
      this.model.setTickOwnerId(this.snapshotKeyId);
      this.model.attachHost(this);
      attachModelAccessors(this, this.model);
      this.modelBound = true;
    }
  }

  /** 由子类的 Model 在构造完成后调用，安装字段访问器（存储仍在 Model）。 */
  public bindModel(): void {
    if (this.modelBound || !this.model) return;
    this.modelBound = true;
    attachModelAccessors(this, this.model);
  }

  public setLogicFrame(frame: number): void {
    if (this.model) setModelFrame(this.model, frame, logicEvents);
    else logicEvents.setFrame(frame);
  }

  public onRenderUpdate(_renderDt: number): void { }

  public consumeLogicEvents(handler: (event: LogicEventRecord) => void): void {
    const events = logicEvents.consume(this.lastConsumedEventId, this.SnapshotId);
    for (const event of events) {
      this.lastConsumedEventId = Math.max(this.lastConsumedEventId, event.eventId);
      handler(event);
    }
  }

  // --- ModelHost ------------------------------------------------------------

  public get gridSizeX(): number { return PositionManager.Instance.GRID_SIZEX; }

  public emit(type: string, data: JsonValue = null): void {
    logicEvents.emit(type, this.SnapshotId, data);
  }

  public createExplosion(_config: Record<string, unknown>, _x?: number, _y?: number, _row?: number): void { /* 由投射物 Entity 覆写 */ }
  public createProjectile(_model: unknown, _config: Record<string, unknown>): void { /* 由投射物 Entity 覆写 */ }
  public applyDebuffTo(target: unknown, name: string, durationMs: number): void {
    (target as { addDebuff?: (debuff: string, duration: number) => void })?.addDebuff?.(name, durationMs);
  }
  public applyDamage(target: unknown, amount: number, dealer: unknown, source: unknown): void {
    (target as { takeDamage?: (amount: number, dealer?: unknown, source?: unknown) => void })
      ?.takeDamage?.(amount, dealer, source);
  }
  public hasAttacked(_target: unknown): boolean { return false; }
  public markAttacked(_target: unknown): void { }
  public hasPenetrated(_target: unknown): boolean { return false; }
  public markPenetrated(_target: unknown): void { }
  public destroySelf(): void { this.destroy(); }
  public setEnhancement(_value: string): void { }

  public setVisible(visible: boolean) { this.viewGroup.setVisible(visible); }

  /** 默认无视图可同步；Entity 子类按 Model 状态覆写。 */
  public syncViewFromModel(): void { }

  protected abstract buildView(): void;

  public updateView(vec: Vector, rotation?: number): void {
    const dx = vec.x - this.x;
    const dy = vec.y - this.y;
    this.x = vec.x;
    this.y = vec.y;

    this.viewGroup.getChildren().forEach((child: any) => {
      if (child.x !== undefined) {
        child.x += dx;
        child.y += dy;
        if (rotation !== undefined && child.setRotation) child.setRotation(rotation);
      }
    });
  }

  public stepUpdate(): void {
    this.model?.onModelStep?.(this);
  }

  public stepMove(_alpha: number): void { }

  public destroy(): void {
    if (this.isDestroyQueued || this.isDestroyed) return;
    this.isDestroyQueued = true;
    // 死亡效果由 Model 定义，Entity 只负责调度。
    this.model?.onModelDestroy?.(this);
    DeferredManager.Instance.defer(() => {
      if (this.isDestroyed) return;
      if (this.rigidBody) {
        forgetRigidBody(this);
        this.scene.rapierWorld.removeRigidBody(this.rigidBody);
        this.rigidBody = null;
      }
      this.viewGroup.destroy(true, true);
      this.model?.disposeTickManager();
      this.isDestroyed = true;
    });
  }

  public abstract onCollision(ctx: CollisionContext): void;

  // --- 快照 -----------------------------------------------------------------

  protected getRelationFields(): readonly string[] { return NO_RELATION_FIELDS; }
  protected getPrngFields(): readonly string[] { return []; }
  protected captureLogicState(): Record<string, JsonValue> {
    return { lastConsumedEventId: this.lastConsumedEventId };
  }
  protected restoreLogicState(state: Record<string, JsonValue>, _context: RestoreContext): void {
    const cursor = state.lastConsumedEventId;
    this.lastConsumedEventId = typeof cursor === "number" && Number.isFinite(cursor)
      ? Math.max(0, Math.trunc(cursor))
      : 0;
  }
  protected captureExtraState(): Record<string, JsonValue> {
    return { lastConsumedEventId: this.lastConsumedEventId };
  }

  private readModelNumber(name: string, fallback: unknown): number | null {
    const state = this.model ? snapshotModel(this.model) : {};
    const value = state[name];
    if (typeof value === "number") return value;
    return typeof fallback === "number" ? fallback : null;
  }

  public captureSnapshot(): EntityLogicState {
    rememberRigidBody(this);
    const obj = this as unknown as Record<string, unknown>;
    const rigidBody = this.rigidBody;
    const translation = rigidBody?.translation?.();

    return {
      kind: "entity",
      id: this.SnapshotId,
      col: typeof obj.col === "number" ? obj.col : null,
      row: typeof obj.row === "number" ? obj.row : null,
      x: translation?.x ?? this.x,
      y: translation?.y ?? this.y,
      hp: this.readModelNumber("health", obj.health),
      maxHp: this.readModelNumber("healthMax", obj.maxHealth),
      speed: this.readModelNumber("speed", obj.speed),
      flags: {
        ...captureRelations(this, this.getRelationFields()),
        ...capturePrngs(this, this.getPrngFields()),
        ...this.captureLogicState(),
        model: this.model ? snapshotModel(this.model) : {},
      },
      timers: this.model?.captureTimers() ?? [],
      extra: {
        rigidBodyHandle: rigidBody ? rigidBody.handle : null,
        hasRigidBody: Boolean(rigidBody),
        ...this.captureExtraState(),
      },
    };
  }

  public restoreSnapshot(state: EntityLogicState, context: RestoreContext): void {
    restoreRelations(this, state.flags, context, this.getRelationFields());
    restorePrngs(this, state.flags, this.getPrngFields(), context);
    this.restoreLogicState(state.flags, context);
    this.model?.restoreTimers(state.timers ?? [], context);

    const modelState = state.flags.model;
    if (this.model && modelState && typeof modelState === "object" && !Array.isArray(modelState)) {
      restoreModel(this.model, modelState as Record<string, JsonValue>);
    }
    if (state.hp !== null) this.writeModelNumber("health", state.hp);
    if (state.maxHp !== null) this.writeModelNumber("healthMax", state.maxHp);
    if (state.speed !== null) this.writeModelNumber("speed", state.speed);
    this.applySnapshotPosition(state.x, state.y);
    this.syncViewFromModel();
  }

  private writeModelNumber(name: string, value: number): void {
    if (!this.model) return;
    const state = snapshotModel(this.model);
    if (name in state) restoreModel(this.model, { ...state, [name]: value });
  }

  protected applySnapshotPosition(x: number, y: number): void {
    const dx = x - this.x;
    const dy = y - this.y;
    this.x = x;
    this.y = y;

    if (dx !== 0 || dy !== 0) {
      this.viewGroup.getChildren().forEach((child: any) => {
        if (child.x !== undefined) {
          child.x += dx;
          child.y += dy;
        }
      });
    }
    if (this.rigidBody) this.rigidBody.setTranslation({ x, y }, true);
  }
}
