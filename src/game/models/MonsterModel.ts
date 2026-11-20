import seedrandom from "seedrandom";
import type { Game } from "../scenes/Game";
import type { BaseEntity } from "./core/BaseEntity";
import { CombatEntity } from "./core/CombatEntity";
import type { MonsterEntity } from "./entities/MonsterEntity";
import { LogicModel } from "../core/logic/LogicModel";
import type { JsonValue } from "../core/SimulationState";
import type { ITickTimerHandle } from "../core/logic/EntityTickManager";
import { DEFAULT_TICK_EVENT_NAMES } from "../core/logic/TickEvents";
import { Faction } from "./Enum";
import PlantHelper from "../utils/helper/PlantHelper";
import CombatManager from "../managers/CombatManager";
import { PositionManager } from "../managers/view/PositionManager";
import ResourceCmd from "../utils/cmd/ResourceCmd";
import type { CollisionContext } from "../types";

const MONSTER_EVENTS = {
  Attack: "MonsterAttack",
  DeathSettle: "MonsterDeathSettle",
} as const;

/** 死亡表现时长（与 DeathRotateSfx 的 400ms 对齐），仅决定纯表现何时结束。 */
const DEATH_SETTLE_MS = 400;

export abstract class MonsterModel extends LogicModel {
  public override readonly tickEventNames: readonly string[] = [
    ...DEFAULT_TICK_EVENT_NAMES,
    MONSTER_EVENTS.Attack,
    MONSTER_EVENTS.DeathSettle,
  ];

  /** 以下运行时字段全部自动进入快照；新增字段直接写在这里即可。 */
  public waveID: number = -1;
  public health: number = 0;
  public speed: number = 0;
  public originalSpeed: number = 0;
  public isFlying: boolean = false;
  public isInVoid: boolean = false;
  public isDying: boolean = false;
  public isFrozen: boolean = false;
  public isStop: boolean = false;
  public carryStarShards: boolean = false;
  public carriedStarShards: number = 0;
  public starShardsDropped: boolean = false;
  public currentStage: number = -1;
  public hasStick: boolean = false;
  public vaultTargetX: number = 0;
  public isAttacking: boolean = false;
  public isHidden: boolean = false;
  public flashTriggered: boolean = false;
  public lastSkill: number = 0;
  public callCount: number = 0;
  public buffApplied: boolean = false;
  public skill1LastRow: number = -1;
  public arrowDamage: number = 0;
  public arrowInterval: number = 0;
  public hpTriggers: number[] = [];
  public damageThresholds: number[] = [];
  /** 实体引用关系留在 Entity 编解码，Model 只保存其稳定 id。 */
  public attackingId: string | null = null;

  public abstract readonly mid: number;
  public abstract readonly nameKey: string;
  public abstract readonly texturePath: string;

  public abstract readonly level: number;
  public abstract readonly weight: (waveID: number) => number;
  public abstract readonly leastWaveIDByStageID?: (stageID: number) => number;
  public abstract readonly leastWaveID?: number;

  public readonly rank: "normal" | "elite" | "boss" = "normal";

  public abstract readonly maxHealth: number;
  public abstract readonly baseSpeed: number;
  public abstract readonly attackDamage: number;
  public abstract readonly attackInterval: number;

  public readonly isDefaultFlying: boolean = false;
  public readonly isDefaultInVoid: boolean = false;
  public readonly couldCarryStarShards: boolean = true;

  public abstract getWeight(waveID: number): number;

  /** 每个实体由 Model 负责初始化自己的运行时状态。 */
  public initializeState(scene: Game, col: number, row: number, waveID: number): void {
    this.waveID = waveID;
    this.health = this.maxHealth;
    this.healthMax = this.maxHealth;
    this.originalSpeed = this.baseSpeed;
    this.speed = this.originalSpeed;
    this.isFlying = this.isDefaultFlying;
    this.isInVoid = this.isDefaultInVoid;
  }

  /** 普攻定时器由 Model 创建；Entity 只保存句柄用于停止。 */
  public beginAttackTimer(_entity: MonsterEntity, intervalMs: number): ITickTimerHandle {
    return this.tickmanager.schedule(MONSTER_EVENTS.Attack, intervalMs, { loop: true });
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === MONSTER_EVENTS.Attack) {
      (this.host as MonsterEntity | null)?.hurtTarget();
      return;
    }
    if (eventName === MONSTER_EVENTS.DeathSettle) {
      (this.host as MonsterEntity | null)?.destroy();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  // --- 通用战斗逻辑：Entity 只做胶水调用，决策全部留在这里 -----------------

  public getSpawnViewOffset(col: number, row: number, spawnSeq: number): { x: number; y: number } {
    const rng = seedrandom.alea(
      `${CombatManager.Instance.seed}:${this.waveID}:${col}:${row}:${spawnSeq}`,
    );
    return {
      x: rng() * PositionManager.Instance.GRID_SIZEX / 5,
      y: rng() * PositionManager.Instance.GRID_SIZEY / 10,
    };
  }

  public checkOutOfBounds(entity: MonsterEntity): void {
    if (entity.x >= PositionManager.Instance.getWorldBounds().left) return;
    entity.destroySelf();
    CombatManager.Instance.EndGame(false);
  }

  public tryStartAttack(entity: MonsterEntity, target: BaseEntity): boolean {
    if (this.isFrozen || !this.canStartAttack(target)) return false;

    const current = entity.attacking as unknown as { col?: number; row?: number } | null;
    if (current && typeof current.col === "number" && typeof (target as any).col === "number"
      && PlantHelper.IsMorePriorityPlant(current as any, target as any)) {
      this.stopAttacking(entity);
    }

    entity.attacking = target as any;
    this.attackingId = target.SnapshotId;
    this.isStop = true;
    entity.stopMove();
    (target as any).underAttackBy?.add(entity);
    entity.animController.startArmSwing();
    (entity as any).attackTimer = this.beginAttackTimer(entity, this.attackInterval);
    this.onAttackStarted(entity);
    return true;
  }

  public stopAttacking(entity: MonsterEntity): void {
    entity.attacking?.underAttackBy?.delete(entity);
    entity.attacking = null;
    this.attackingId = null;
    entity.animController.stopArmSwing();
    (entity as any).attackTimer?.remove();
    (entity as any).attackTimer = null;
    this.isStop = false;
    this.onAttackStopped(entity);
    entity.startMove();
  }

  /** 武器能力 mixin 覆写；Model 决定开始/停止攻击，Entity 只按状态播放动画。 */
  public onAttackStarted(_entity: MonsterEntity): void { }
  public onAttackStopped(_entity: MonsterEntity): void { }

  public hurtTarget(entity: MonsterEntity): void {
    const target = entity.attacking;
    if (!target || !this.isValidAttackTarget(target)) {
      this.stopAttacking(entity);
      return;
    }
    target.takeDamage(this.attackDamage, entity as any);
    if (!this.isValidAttackTarget(entity.attacking)) this.stopAttacking(entity);
  }

  public isValidAttackTarget(target: BaseEntity | null): boolean {
    if (!target || target.SnapshotId !== this.attackingId || target.currentHealth <= 0) return false;
    return this.canStartAttack(target);
  }

  /** 目标是否可作为新的普攻对象；已锁定的目标仍可被当前攻击继续命中。 */
  public canStartAttack(target: BaseEntity): boolean {
    if (!(target instanceof CombatEntity)) return false;
    if (target.currentHealth <= 0) return false;
    if (target.faction === Faction.ZOMBIE) return false;
    if ((target as { hasExploded?: boolean }).hasExploded) return false;
    const targetModel = (target as { model?: { isFlying?: boolean; isInVoid?: boolean } }).model;
    if (targetModel?.isFlying && !this.isFlying) return false;
    if (targetModel?.isInVoid) return false;
    return true;
  }

  public takeDamage(entity: MonsterEntity, amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (entity.currentHealth <= 0 || this.isDying) return;
    const realDamage = Math.min(amount, entity.currentHealth);
    entity.currentHealth -= amount;
    this.health = entity.currentHealth;
    this.onHurt(entity, amount, realDamage, dealer, source);
    entity.animController.highlight();
    if (entity.currentHealth <= 0) {
      entity.currentHealth = 0;
      this.health = 0;
      this.zombieDie(entity);
    }
  }

  public onCollision(entity: MonsterEntity, ctx: CollisionContext): void {
    const target = ctx.targetEntity as unknown as BaseEntity;
    if (target && (target as any).faction !== undefined && (target as any).faction !== Faction.ZOMBIE) {
      this.tryStartAttack(entity, target);
    }
  }

  public zombieDie(entity: MonsterEntity): void {
    if (this.isDying) return;
    this.isDying = true;
    this.dropCarriedStarShards(entity);
    this.stopAttacking(entity);
    (entity as any).playDeathAnimation();

    // 击杀入账、赛道移除与波次推进由权威帧定时器驱动，不能挂在 Phaser 死亡
    // 动画的 onComplete 上。表现时钟在暂停/回滚/帧率差异下两端不一致，会让
    // 同帧清波（如 TNT 爆炸）的 killed_count 达标帧不同，进而使下一波计时器
    // 的启动时刻分叉。DeathSettle 进入 Model 快照，重放时在同一权威帧触发。
    this.tickmanager.schedule(MONSTER_EVENTS.DeathSettle, DEATH_SETTLE_MS);
  }

  public addStarShards(entity: MonsterEntity, amount = 1): void {
    if (amount <= 0) return;
    this.carryStarShards = true;
    this.carriedStarShards += amount;
    (entity as any).startStarShardsOrbitEffect();
  }

  public dropCarriedStarShards(entity: MonsterEntity): void {
    if (this.starShardsDropped || !this.carryStarShards) return;
    this.starShardsDropped = true;
    ResourceCmd.AddStarshardToAll(Math.max(1, this.carriedStarShards));
    this.carryStarShards = false;
    this.carriedStarShards = 0;
  }

  public updateBodyDamageStage(entity: MonsterEntity, thresholds: number[]): void {
    let stage = -1;
    for (let i = 0; i < thresholds.length; i++) {
      if (entity.currentHealth <= thresholds[i]) stage = i;
    }
    if (stage === this.currentStage) return;
    this.currentStage = stage;
    const raw = (entity.animController as any)?.raw as { switchBodyFrame?: (value: boolean | number) => void } | undefined;
    const fn = raw?.switchBodyFrame?.bind(raw);
    if (!fn) return;
    if (thresholds.length === 1) fn(stage >= 0);
    else fn(stage < 0 ? 0 : Math.min(stage + 1, thresholds.length));
  }

  public onCreate(_entity: MonsterEntity) { }

  public onHurt(_entity: MonsterEntity, _damage: number, _realDamage: number,
    _dealer?: BaseEntity, _source?: BaseEntity) { }

  public onDeath(_entity: MonsterEntity) { }

  protected initializeEntity<TEntity extends MonsterEntity>(entity: TEntity): TEntity {
    return entity.initializeEntity();
  }

  public abstract createEntity(scene: Game, col: number, row: number, waveID: number): MonsterEntity;
}
