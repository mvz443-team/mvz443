import type { Game } from "../../../scenes/Game";
import type { BaseEntity } from "../../../models/core/BaseEntity";
import type { ModelHost } from "../../../core/logic/LogicModel";
import type { CollisionContext } from "../../../types";
import { PositionManager } from "../../../managers/view/PositionManager";
import { MonsterEntity, PresetMonsterModel, type MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { Faction } from "../../../models/Enum";
import { MonsterSpeed } from "../../../../constants/game";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import { createBalloonTntAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";

/** 气球TNT 分身的怪物 id；不会进入出怪池，只由星之碎片召唤。 */
export const BALLOON_TNT_CLONE_MID = 21;

/**
 * 气球TNT 分身（星之碎片召唤物）。
 *
 * - PLANT 阵营的飞行单位：僵尸的箭/子弹可以打它，己方植物不会瞄准它。
 * - 以普通僵尸速度向右飞行，200 血。
 * - 碰到第一个僵尸，或飞到最右列时，产生一次与本体同伤害的 3x3 爆炸。
 * - 不会攻击任何目标（`canStartAttack` 恒为 false），也不抢普攻定时器。
 */
export class BalloonTntCloneModel extends PresetMonsterModel {
  /** 爆炸伤害由召唤它的植物按自身等级写入；进快照。 */
  public explosionDamage: number = 350;
  /** 一次性标记，防止同帧重复爆炸。 */
  public hasExploded: boolean = false;

  public constructor(def: MonsterDefinition) {
    super(def);
  }

  public override initializeState(scene: Game, col: number, row: number, waveID: number): void {
    super.initializeState(scene, col, row, waveID);
    // 向右飞：MonsterEntity.startMove() 使用 -speed，这里把速度取负。
    this.speed = -Math.abs(this.baseSpeed);
    this.originalSpeed = this.speed;
  }

  /** 分身只负责飞过去爆炸，从不索敌攻击。 */
  public override canStartAttack(_target: BaseEntity): boolean {
    return false;
  }

  /** 碰到第一个僵尸立即爆炸（碰撞事件驱动，怪物 collider 已开 KINEMATIC_KINEMATIC）。 */
  public override onCollision(entity: BalloonTntCloneEntity, ctx: CollisionContext): void {
    if (this.hasExploded || this.isDying) return;
    if (entity.currentHealth <= 0) return;

    const target = ctx.targetEntity as BaseEntity | undefined;
    if (!target || target.faction !== Faction.ZOMBIE) return;
    if ((target.currentHealth ?? 0) <= 0) return;

    this.explode(entity);
  }

  /** 只保留右边界判定：飞出场地最右侧时自爆。 */
  public override onModelStep(host: ModelHost): void {
    const entity = host as BalloonTntCloneEntity;
    if (this.hasExploded || this.isDying) return;
    if (entity.currentHealth <= 0) return;

    const gridX = PositionManager.Instance.GRID_SIZEX;
    const lastCol = Math.max(0, PositionManager.Instance.Col_Number - 1);
    const rightEdgeX = PositionManager.Instance.getGridTopLeft(lastCol, entity.row).x + gridX * 0.5;
    if (entity.x >= rightEdgeX) this.explode(entity);
  }

  public explode(entity: BalloonTntCloneEntity): void {
    if (this.hasExploded) return;
    this.hasExploded = true;

    ProjectileCmd.CreateExplosion(entity.scene, entity.x, entity.row, {
      damage: this.explosionDamage,
      leftGrid: 1.5,
      rightGrid: 1.5,
      upGrid: 1,
      downGrid: 1,
      faction: Faction.PLANT,
      dealer: entity,
    });

    entity.destroySelf();
  }
}

export class BalloonTntCloneEntity extends MonsterEntity {
  declare public model: BalloonTntCloneModel;

  public constructor(scene: Game, col: number, row: number, model: BalloonTntCloneModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected buildView(): void {
    if (this.animController) return;
    this.animController = createBalloonTntAnimController(this.scene, this.x, this.y);
    this.animController.setDepth(this.baseDepth);
  }

  protected onHurt(_amount: number, _realDamage: number, _dealer?: BaseEntity, _source?: BaseEntity): void { }

  protected onDeath(): void {
    this.model.zombieDie(this);
  }
}

export const BalloonTntCloneData = new BalloonTntCloneModel({
  mid: BALLOON_TNT_CLONE_MID,
  nameKey: "BalloonTntClone",
  level: 1,
  // 永不进入出怪池：只由星之碎片召唤。
  weight: () => 0,
  leastWaveID: 999999,
  maxHealth: 200,
  baseSpeed: MonsterSpeed.Zombie,
  baseAttackDamage: 0,
  attackInterval: 1000,
  isDefaultFlying: true,
  couldCarryStarShards: false,
  faction: Faction.PLANT,
  createEntity: (scene, col, row, model, waveID) =>
    new BalloonTntCloneEntity(scene, col, row, model as BalloonTntCloneModel, waveID),
});
