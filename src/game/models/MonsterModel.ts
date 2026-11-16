import type { Game } from "../scenes/Game";
import type { BaseEntity } from "./core/BaseEntity";
import type { MonsterEntity } from "./entities/MonsterEntity";
import { LogicModel } from "../core/logic/LogicModel";

export abstract class MonsterModel extends LogicModel {
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
  public starShardsDropped: number = 0;
  public offsetX: number = 0;
  public offsetY: number = 0;
  public currentStage: number = 0;
  public armorHealth: number = 0;
  public armorBroken: boolean = false;
  public armorKey: string = "";
  public hasStick: boolean = false;
  public vaultTargetX: number = 0;
  public isAttacking: boolean = false;
  public isHidden: boolean = false;
  public flashTriggered: boolean = false;
  public lastSkill: number = 0;
  public callCount: number = 0;
  public shellHealth: number = 0;
  public broken: boolean = false;
  public buffApplied: boolean = false;
  public skill1LastRow: number = -1;
  public arrowDamage: number = 0;
  public arrowInterval: number = 0;
  public shieldHealth: number = 0;
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

  public onCreate(_entity: MonsterEntity) { }

  public onHurt(_entity: MonsterEntity, _damage: number, _realDamage: number,
    _dealer?: BaseEntity, _source?: BaseEntity) { }

  public onDeath(_entity: MonsterEntity) { }

  protected initializeEntity<TEntity extends MonsterEntity>(entity: TEntity): TEntity {
    return entity.initializeEntity();
  }

  public abstract createEntity(scene: Game, col: number, row: number, waveID: number): MonsterEntity;
}
