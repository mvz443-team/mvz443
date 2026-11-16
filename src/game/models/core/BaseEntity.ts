import uniqueId from "lodash/uniqueId";
import type { Game } from "../../scenes/Game";
import TickerManager, { TickerManagerProxy } from "../../managers/combat/TickerManager";
import RAPIER, { Vector } from "@dimforge/rapier2d-deterministic-compat";
import { CollisionContext } from "../../types";
import { DeferredManager } from "../../managers/DeferredManager";
import type { EntityLogicState, JsonValue } from "../../core/SimulationState";
import type { RestoreContext, Restorable } from "../../core/Restorable";
import {
  DEFAULT_ENTITY_SNAPSHOT_FIELDS,
  captureEntityFields,
  restoreEntityFields,
} from "../../core/EntitySnapshot";
import { forgetRigidBody, rememberRigidBody } from "../../core/PhysicsSnapshot";

// All entities share world position, visual state, and destruction lifecycle.
export abstract class BaseEntity implements Restorable<EntityLogicState> {
  public scene: Game;
  public x: number;
  public y: number;

  public abstract baseDepth: number;
  /** 快照中的稳定标识；同进程内等于 TimerKey。 */
  public get SnapshotId(): string { return this.TimerKey; }
  public get snapshotKey(): string { return this.TimerKey; }
  public get TimerGroupKey(): string { return this.TimerKey; }
  public get IsAlive(): boolean { return !this.isDestroyQueued && !this.isDestroyed; }

  /**
   * 采用稳定的计时器 key（例如 plant:col:row:pid）。
   * 重建实体时使用同一 key，才能使快照中的计时器组对齐。
   */
  public adoptStableTimerKey(key: string): void {
    if (!key || key === this.TimerKey) return;
    TickerManager.Instance.RenameGroup(this.TimerKey, key);
    this.TimerKey = key;
    this.tickmanager = new TickerManagerProxy(key);
  }

  // Timer key
  private TimerKey: string;
  // Timer proxy
  public tickmanager: TickerManagerProxy;

  public rigidBody: RAPIER.RigidBody | null = null;
  // Shared render container
  public viewGroup: Phaser.GameObjects.Group;
  private isDestroyQueued = false;
  private isDestroyed = false;

  constructor(scene: Game, x: number, y: number) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.viewGroup = scene.add.group();
    this.TimerKey = uniqueId("entity_");
    this.tickmanager = new TickerManagerProxy(this.TimerKey);
  }

  public setVisible(visible: boolean) {
    // Toggle visibility for the whole entity view.
    this.viewGroup.setVisible(visible);
  }

  // Subclasses decide how to build their own visuals and physics.
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
        if (rotation !== undefined && child.setRotation) {
          child.setRotation(rotation);
        }
      }
    });
  }

  // Logic-step hook.
  public stepUpdate(): void { }

  // Render-step hook for interpolation.
  public stepMove(_alpha: number): void { }

  // Shared destruction flow.
  public destroy(): void {
    if (this.isDestroyQueued || this.isDestroyed) {
      return;
    }
    this.isDestroyQueued = true;
    DeferredManager.Instance.defer(() => {
      if (this.isDestroyed) {
        return;
      }
      if (this.rigidBody) {
        forgetRigidBody(this);
        this.scene.rapierWorld.removeRigidBody(this.rigidBody);
        this.rigidBody = null;
      }
      this.viewGroup.destroy(true, true);
      TickerManager.Instance.RemoveGroup(this.TimerKey);
      this.isDestroyed = true;
    });
  }

  public abstract onCollision(ctx: CollisionContext): void;

  // ---------------------------------------------------------------------------
  // 统一快照接口
  // ---------------------------------------------------------------------------

  /** 子类追加需要采集的字段名。 */
  protected getSnapshotFields(): readonly string[] {
    return DEFAULT_ENTITY_SNAPSHOT_FIELDS;
  }

  /** 子类可覆盖：导出额外的纯数据逻辑字段。 */
  protected captureLogicState(): Record<string, JsonValue> {
    return {};
  }

  /** 子类可覆盖：恢复额外的纯数据逻辑字段。 */
  protected restoreLogicState(_state: Record<string, JsonValue>, _context: RestoreContext): void { }

  /** 子类可覆盖：导出非字段形式的运行时信息（例如生成序号）。 */
  protected captureExtraState(): Record<string, JsonValue> {
    return {};
  }

  public captureSnapshot(): EntityLogicState {
    rememberRigidBody(this);
    const obj = this as unknown as Record<string, unknown>;
    const rigidBody = this.rigidBody;
    const translation = rigidBody?.translation?.();
    const hp = (obj.currentHealth ?? obj.health) as number | undefined;
    const maxHp = obj.maxHealth as number | undefined;
    const speed = obj.speed as number | undefined;

    return {
      kind: "entity",
      id: this.SnapshotId,
      col: typeof obj.col === "number" ? obj.col : null,
      row: typeof obj.row === "number" ? obj.row : null,
      x: translation?.x ?? this.x,
      y: translation?.y ?? this.y,
      hp: typeof hp === "number" ? hp : null,
      maxHp: typeof maxHp === "number" ? maxHp : null,
      speed: typeof speed === "number" ? speed : null,
      flags: captureEntityFields(this, this.getSnapshotFields(), this.captureLogicState()),
      timers: TickerManager.Instance.GetTimerStates().filter((timer) => timer.group === this.TimerKey),
      extra: {
        rigidBodyHandle: rigidBody ? rigidBody.handle : null,
        hasRigidBody: Boolean(rigidBody),
        ...this.captureExtraState(),
      },
    };
  }

  public restoreSnapshot(state: EntityLogicState, context: RestoreContext): void {
    restoreEntityFields(this, state.flags, context, this.getSnapshotFields());

    if (state.hp !== null) {
      const obj = this as unknown as Record<string, unknown>;
      if (typeof obj.currentHealth === "number") obj.currentHealth = state.hp;
      if (typeof obj.health === "number") obj.health = state.hp;
    }
    if (state.maxHp !== null && typeof (this as unknown as Record<string, unknown>).maxHealth === "number") {
      (this as unknown as Record<string, number>).maxHealth = state.maxHp;
    }
    if (state.speed !== null && typeof (this as unknown as Record<string, unknown>).speed === "number") {
      (this as unknown as Record<string, number>).speed = state.speed;
    }

    this.applySnapshotPosition(state.x, state.y);
    this.restoreLogicState(state.flags, context);
  }

  /** 把逻辑坐标写回自身、视图容器与刚体。 */
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

    if (this.rigidBody) {
      this.rigidBody.setTranslation({ x, y }, true);
    }
  }
}
