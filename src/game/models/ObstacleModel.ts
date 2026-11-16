import { Game } from "../scenes/Game";
import { BaseEntity } from "./core/BaseEntity";
import { ObstacleConfig, ObstacleEntity } from "./entities/ObstacleEntity";
import { RegisterSchema } from "../core/LogicRegister";
import { OBSTACLE_LOGIC_SCHEMA } from "../core/LogicSchemas";

export abstract class ObstacleModel {
  /** 逻辑寄存器声明表；实体按此分配寄存器并参与快照。 */
  public readonly logicSchema: RegisterSchema = OBSTACLE_LOGIC_SCHEMA;

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
