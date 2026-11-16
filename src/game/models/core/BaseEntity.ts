import uniqueId from "lodash/uniqueId";
import type { Game } from "../../scenes/Game";
import TickerManager, { TickerManagerProxy } from "../../managers/combat/TickerManager";
import RAPIER, { Vector } from "@dimforge/rapier2d-deterministic-compat";
import { CollisionContext } from "../../types";
import { DeferredManager } from "../../managers/DeferredManager";
import type { EntityLogicState, JsonValue } from "../../core/SimulationState";
import type { RestoreContext, Restorable } from "../../core/Restorable";
import {
  capturePrngs,
  captureRelations,
  restorePrngs,
  restoreRelations,
} from "../../core/EntitySnapshot";
import { forgetRigidBody, rememberRigidBody } from "../../core/PhysicsSnapshot";
import { RegisterBank, RegisterSchema, bindRegistersToEntity } from "../../core/LogicRegister";
import {
  DEFAULT_RELATION_FIELDS,
  EMPTY_LOGIC_SCHEMA,
} from "../../core/LogicSchemas";

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

  /** Model 声明的逻辑寄存器组；实体状态快照的唯一数值来源。 */
  public readonly reg: RegisterBank;
  private registersBound = false;

  constructor(scene: Game, x: number, y: number, schema: RegisterSchema = EMPTY_LOGIC_SCHEMA) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.viewGroup = scene.add.group();
    this.TimerKey = uniqueId("entity_");
    this.tickmanager = new TickerManagerProxy(this.TimerKey);
    this.reg = schema.createBank();
  }

  /**
   * 在子类字段初始化完成后调用：把同名数据字段迁移进寄存器，
   * 并安装同名访问器，使既有业务代码继续读写 this.xxx 时实际走寄存器。
   */
  public bindLogicRegisters(): void {
    if (this.registersBound) return;
    this.registersBound = true;
    bindRegistersToEntity(this, this.reg);
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

  /** 子类声明需要显式序列化的关系字段（实体引用/Set）。 */
  protected getRelationFields(): readonly string[] {
    return DEFAULT_RELATION_FIELDS;
  }

  /** 子类声明带 state() 的 PRNG 字段。 */
  protected getPrngFields(): readonly string[] {
    return [];
  }

  /** 子类可覆盖：导出非寄存器、非关系的纯数据逻辑字段。 */
  protected captureLogicState(): Record<string, JsonValue> {
    return {};
  }

  /** 子类可覆盖：恢复非寄存器、非关系的纯数据逻辑字段。 */
  protected restoreLogicState(_state: Record<string, JsonValue>, _context: RestoreContext): void { }

  /** 子类可覆盖：导出非字段形式的运行时信息（例如生成序号）。 */
  protected captureExtraState(): Record<string, JsonValue> {
    return {};
  }

  private readRegisterNumber(name: string, fallback: unknown): number | null {
    if (this.reg.has(name)) {
      const value = this.reg.get(name);
      if (typeof value === "number") return value;
    }
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
      hp: this.readRegisterNumber("currentHealth", obj.health),
      maxHp: this.readRegisterNumber("maxHealth", obj.maxHealth),
      speed: this.readRegisterNumber("speed", obj.speed),
      registers: this.reg.capture(),
      registerVersion: this.reg.schema.fingerprint,
      flags: {
        ...captureRelations(this, this.getRelationFields()),
        ...capturePrngs(this, this.getPrngFields()),
        ...this.captureLogicState(),
      },
      timers: TickerManager.Instance.GetTimerStates().filter((timer) => timer.group === this.TimerKey),
      extra: {
        rigidBodyHandle: rigidBody ? rigidBody.handle : null,
        hasRigidBody: Boolean(rigidBody),
        ...this.captureExtraState(),
      },
    };
  }

  public restoreSnapshot(state: EntityLogicState, context: RestoreContext): void {
    if (state.registers) {
      if (state.registerVersion === this.reg.schema.fingerprint) {
        if (!this.reg.restore(state.registers as Array<number | boolean | string>)) {
          context.report.errors.push(`register-length-mismatch:${this.SnapshotId}`);
        }
      } else {
        context.report.missing.push(
          `registers:${this.SnapshotId}(schema ${state.registerVersion ?? "?"} != ${this.reg.schema.fingerprint})`,
        );
      }
    } else {
      // 兼容旧快照：只回写通用数值
      if (state.hp !== null && this.reg.has("currentHealth")) this.reg.set("currentHealth", state.hp);
      if (state.maxHp !== null && this.reg.has("maxHealth")) this.reg.set("maxHealth", state.maxHp);
      if (state.speed !== null && this.reg.has("speed")) this.reg.set("speed", state.speed);
    }

    restoreRelations(this, state.flags, context, this.getRelationFields());
    restorePrngs(this, state.flags, this.getPrngFields(), context);
    this.restoreLogicState(state.flags, context);
    this.applySnapshotPosition(state.x, state.y);
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
