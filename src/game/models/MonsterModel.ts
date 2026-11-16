import seedrandom from "seedrandom";
import type { Game } from "../scenes/Game";
import type { BaseEntity } from "./core/BaseEntity";
import type { MonsterEntity } from "./entities/MonsterEntity";
import { LogicModel } from "../core/logic/LogicModel";
import type { JsonValue } from "../core/SimulationState";
import type { ITickTimerHandle } from "../core/logic/EntityTickManager";
import { DEFAULT_TICK_EVENT_NAMES, TickEventNameEnums } from "../core/logic/TickEvents";
import { Faction } from "./Enum";
import PlantHelper from "../utils/helper/PlantHelper";
import CombatManager from "../managers/CombatManager";
import { PositionManager } from "../managers/view/PositionManager";
import ResourceCmd from "../utils/cmd/ResourceCmd";
import type { CollisionContext } from "../types";

export abstract class MonsterModel extends LogicModel {
  public override readonly tickEventNames = [
    ...DEFAULT_TICK_EVENT_NAMES,
    TickEventNameEnums.MonsterAttack,
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
  public offsetX: number = 0;
  public offsetY: number = 0;
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

  /** 普攻定时器由 Model 创建；Entity 只保存句柄用于停止。 */
  public beginAttackTimer(_entity: MonsterEntity, intervalMs: number): ITickTimerHandle {
    return this.tickmanager.schedule(TickEventNameEnums.MonsterAttack, intervalMs, { loop: true });
  }

  public override handleTickEvent(
    eventName: TickEventNameEnums | string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === TickEventNameEnums.MonsterAttack) {
      (this.host as MonsterEntity | null)?.hurtTarget();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  // --- 通用战斗逻辑：Entity 只做胶水调用，决策全部留在这里 -----------------

  public applySpawnSeed(entity: MonsterEntity, spawnSeq: number): void {
    const rng = seedrandom.alea(
      `${CombatManager.Instance.seed}:${entity.waveID}:${entity.col}:${entity.row}:${spawnSeq}`,
    );
    entity.offsetX = rng() * PositionManager.Instance.GRID_SIZEX / 5;
    entity.offsetY = rng() * PositionManager.Instance.GRID_SIZEY / 10;
  }

  public checkOutOfBounds(entity: MonsterEntity): void {
    if (entity.x >= PositionManager.Instance.getWorldBounds().left) return;
    entity.destroySelf();
    CombatManager.Instance.EndGame(false);
  }

  public tryStartAttack(entity: MonsterEntity, target: BaseEntity): boolean {
    if (entity.isFrozen || entity.attacking === target) return false;

    const targetMonster = target as unknown as MonsterEntity;
    if (targetMonster.isFlying && !entity.isFlying) return false;
    if (targetMonster.isInVoid) return false;

    const current = entity.attacking as unknown as { col?: number; row?: number } | null;
    if (current && typeof current.col === "number" && typeof (target as any).col === "number"
      && PlantHelper.IsMorePriorityPlant(current as any, target as any)) {
      this.stopAttacking(entity);
    }

    entity.attacking = target as any;
    entity.isStop = true;
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
    entity.animController.stopArmSwing();
    (entity as any).attackTimer?.remove();
    (entity as any).attackTimer = null;
    entity.isStop = false;
    this.onAttackStopped(entity);
    entity.startMove();
  }

  /** 武器能力 mixin 覆写；Model 决定开始/停止攻击，Entity 只按状态播放动画。 */
  public onAttackStarted(_entity: MonsterEntity): void { }
  public onAttackStopped(_entity: MonsterEntity): void { }

  public hurtTarget(entity: MonsterEntity): void {
    const target = entity.attacking;
    if (!target || target.currentHealth <= 0) {
      this.stopAttacking(entity);
      return;
    }
    target.takeDamage(this.attackDamage, entity as any);
    if (entity.attacking !== target) return;
    if (target.currentHealth <= 0) this.stopAttacking(entity);
  }

  public takeDamage(entity: MonsterEntity, amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (entity.currentHealth <= 0 || entity.isDying) return;
    const realDamage = Math.min(amount, entity.currentHealth);
    entity.currentHealth -= amount;
    entity.health = entity.currentHealth;
    this.onHurt(entity, amount, realDamage, dealer, source);
    entity.animController.highlight();
    if (entity.currentHealth <= 0) {
      entity.currentHealth = 0;
      entity.health = 0;
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
    if (entity.isDying) return;
    this.dropCarriedStarShards(entity);
    this.stopAttacking(entity);
    (entity as any).playDeathAnimation();
  }

  public addStarShards(entity: MonsterEntity, amount = 1): void {
    if (amount <= 0) return;
    entity.carryStarShards = true;
    entity.carriedStarShards += amount;
    (entity as any).startStarShardsOrbitEffect();
  }

  public dropCarriedStarShards(entity: MonsterEntity): void {
    if (entity.starShardsDropped || !entity.carryStarShards) return;
    entity.starShardsDropped = true;
    ResourceCmd.AddStarshardToAll(Math.max(1, entity.carriedStarShards));
    entity.carryStarShards = false;
    entity.carriedStarShards = 0;
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
