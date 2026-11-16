import { Game } from "../scenes/Game";
import { BaseEntity } from "./core/BaseEntity";
import { ObstacleConfig, ObstacleEntity } from "./entities/ObstacleEntity";
import { LogicModel } from "../core/logic/LogicModel";

export abstract class ObstacleModel extends LogicModel {
  /** 障碍运行时状态。 */
  public health: number = 0;
  public extraRow: number = -1;
  public dropped: boolean = false;
  public hasTriggered: boolean = false;

  public abstract readonly oid: number;
  public abstract readonly nameKey: string;
  public abstract readonly texturePath: string;

  public onCreate(_entity: ObstacleEntity) { }

  public onHurt(_entity: ObstacleEntity, _damage: number, _realDamage: number, _dealer?: BaseEntity, _source?: BaseEntity) { }

  public onDeath(_entity: ObstacleEntity) { }

  protected initializeEntity<TEntity extends ObstacleEntity>(entity: TEntity): TEntity {
    return entity.initializeEntity();
  }

  public abstract createEntity(scene: Game, col: number, row: number, config: ObstacleConfig): ObstacleEntity;
}
