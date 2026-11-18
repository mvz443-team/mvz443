import RAPIER, { Vector } from "@dimforge/rapier2d-deterministic-compat";
import DepthHelper from "../../utils/helper/DepthHelper";
import ObstacleManager from "../../managers/combat/ObstacleManager";
import { PositionManager } from "../../managers/view/PositionManager";
import type { Game } from "../../scenes/Game";
import { CollisionContext } from "../../types/CollisionTypes";
import { CombatEntity } from "../core/CombatEntity";
import { BaseEntity } from "../core/BaseEntity";
import { Faction } from "../Enum";
import { ObstacleModel } from "../ObstacleModel";
import { OBSTACLE_RELATION_FIELDS } from "../../core/logic/LogicRelations";
import type { JsonValue } from "../../core/SimulationState";

export interface ObstacleConfig {
  hp: number;
  faction: Faction;
  summoner?: BaseEntity;
  waveId?: number;
}

export abstract class ObstacleEntity extends CombatEntity {
  declare public model: ObstacleModel;

  public col: number;
  public row: number;
  public baseDepth: number;

  public summoner?: BaseEntity;
  public health: number;
  public waveId: number;
  private initialized = false;

  constructor(scene: Game, col: number, row: number, model: ObstacleModel, config: ObstacleConfig) {
    const { x, y } = PositionManager.Instance.getPlantBottomCenter(col, row);
    super(scene, x, y, config.hp, config.faction, model);

    this.col = col;
    this.row = row;
    this.baseDepth = DepthHelper.Plant.base(row);

    this.summoner = config.summoner;
    this.health = config.hp;
    this.waveId = config.waveId ?? -1;
  }

  public get oid() {
    return this.model.oid;
  }

  private buildPhysics() {
    const physicBodySize = PositionManager.Instance.getPlantBodySize();
    const physicsCenter = PositionManager.Instance.getPlantBodyCenterByBottom(this.x, this.y);
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(physicsCenter.x, physicsCenter.y);

    rigidBodyDesc.setUserData(this);

    this.rigidBody = this.scene.rapierWorld.createRigidBody(rigidBodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(physicBodySize.sizeX / 2, physicBodySize.sizeY / 2);
    colliderDesc.setSensor(true);
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    this.scene.rapierWorld.createCollider(colliderDesc, this.rigidBody);
  }

  protected abstract buildView(): void;

  protected override getRelationFields(): readonly string[] {
    return OBSTACLE_RELATION_FIELDS;
  }

  protected override captureLogicState(): Record<string, JsonValue> {
    return {
      ...super.captureLogicState(),
      oid: this.model.oid,
      hp: this.currentHealth,
      faction: this.faction,
      waveId: this.waveId,
    };
  }

  public initializeEntity(): this {
    if (this.initialized) return this;
    this.initialized = true;

    this.buildView();
    this.buildPhysics();
    ObstacleManager.Instance.RegisterObstacle(this);
    this.model.onCreate(this);
    return this;
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    super.takeDamage(amount, dealer, source);
  }

  protected onHurt(amount: number, realDamage: number, dealer?: BaseEntity, source?: BaseEntity): void {
    this.model.onHurt(this, amount, realDamage, dealer, source);
  }

  protected onDeath(): void {
    this.model.onDeath(this);
  }

  public onCollision(_ctx: CollisionContext): void {
    // Obstacle itself does not actively process collision logic for now.
  }

  public override updateView(vec: Vector) {
    const nextPosition = PositionManager.Instance.getPlantBottomCenterByBody(vec.x, vec.y);
    const dx = nextPosition.x - this.x;
    const dy = nextPosition.y - this.y;

    if (dx === 0 && dy === 0) return;

    this.x = nextPosition.x;
    this.y = nextPosition.y;

    const children = this.viewGroup.getChildren();
    for (let i = 0; i < children.length; i++) {
      const part = children[i] as any;
      if (!part) continue;
      part.x += dx;
      part.y += dy;
    }
  }

  public override destroy() {
    this.model.onDeath(this);
    ObstacleManager.Instance.UnregisterObstacle(this);
    super.destroy();
  }

  /** 回滚对账：只移除管理器/视图/刚体，不触发障碍死亡掉落。 */
  protected override onSilentDestroy(): void {
    ObstacleManager.Instance.UnregisterObstacle(this);
  }

  /** 快照中的 x/y 是刚体中心；视图与逻辑坐标必须转换回 bottom-center。 */
  protected override applySnapshotPosition(x: number, y: number): void {
    const bottom = PositionManager.Instance.getPlantBottomCenterByBody(x, y);
    const dx = bottom.x - this.x;
    const dy = bottom.y - this.y;
    this.x = bottom.x;
    this.y = bottom.y;
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
