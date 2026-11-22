import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import type { Game } from "../../scenes/Game";
import { CollisionContext } from "../../types";
import { BaseEntity } from "../core/BaseEntity";
import { CombatEntity } from "../core/CombatEntity";
import { ProjectileConfig, ProjectileModel } from "../projectiles/ProjectileModels";
import { Faction } from "../Enum";
import { _Typedebuffs } from "../../../constants/game";
import { PROJECTILE_RELATION_FIELDS } from "../../core/logic/LogicRelations";
import { isHostile } from "../../core/logic/FactionRelations";
import { ProjectileCmd } from "../../utils/cmd/ProjectileCmd";
import type { ExplosionConfig } from "../projectiles/ProjectileModels";

export abstract class ProjectileEntity<T extends ProjectileModel<any, any>> extends BaseEntity {
  /** BaseEntity 已克隆为实例专属 Model。 */
  public declare model: T;
  /** 同名字段必须写入 Model，否则回滚/重连会丢失阵营并改变碰撞结果。 */
  declare public faction: Faction;

  // 运行时状态
  declare public currentDamage: number;
  /** 命中关系集合，由关系快照负责恢复。 */
  public hasAttackedSet: Set<BaseEntity> = new Set();

  public dealer: CombatEntity | undefined; // 伤害来源实体（比如子弹的发射者）

  declare public debuff: _Typedebuffs;
  declare public debuffDuration: number;

  constructor(scene: Game, x: number, y: number, model: T, cfg: ProjectileConfig) {
    super(scene, x, y, model);
    this.currentDamage = cfg.damage ?? model.damage;
    this.faction = cfg.faction;
    this.dealer = cfg.dealer;

    // 体态（能否命中 tiny/flying/void）属于业务判定，只写在 Model 上。
    this.model.tiny = cfg.tiny ?? this.model.tiny;
    this.model.flying = cfg.flying ?? this.model.flying;
    this.model.inVoid = cfg.inVoid ?? this.model.inVoid;

    this.debuff = cfg.debuff ?? model.debuff;
    this.debuffDuration = cfg.debuffDuration ?? model.debuffDuration;
  }

  /** Model 的唯一实例（BaseEntity 已克隆），Entity 只做视图胶水。 */
  public initializeEntity(): this { return this; }

  public override hasAttacked(target: unknown): boolean { return this.hasAttackedSet.has(target as BaseEntity); }
  public override markAttacked(target: unknown): void { this.hasAttackedSet.add(target as BaseEntity); }

  public override createExplosion(config: Record<string, unknown>, x?: number, _y?: number, row?: number): void {
    ProjectileCmd.CreateExplosion(this.scene, x ?? this.x, row ?? this.row, config as unknown as ExplosionConfig);
  }

  public override createProjectile(model: unknown, config: Record<string, unknown>): void {
    ProjectileCmd.Create(model as never, this.scene, this.x, this.row, config as never);
  }

  protected override getRelationFields(): readonly string[] {
    return PROJECTILE_RELATION_FIELDS;
  }

  // 通用的碰撞分发器
  public onCollision(ctx: CollisionContext): void {
    // 判断是否为战斗实体
    if (!(ctx.targetEntity instanceof CombatEntity)) return;

    // 基本条件过滤
    if (!ctx.targetEntity.takeDamage) return; // 不是可受击对象
    if (this.hasAttackedSet.has(ctx.targetEntity)) return; // 已经攻击过
    if (!isHostile(this, ctx.targetEntity)) return; // 阵营不符（统一走 FactionRelations）

    // 体态判定（tiny / flying / void）由 Model 与 BodyTraits 统一负责。
    if (!this.model.canHit(ctx.targetEntity)) return;

    // 命中效果由 Model 实现，Entity 不写战斗逻辑。
    this.model.applyEffect(this, ctx.targetEntity);
  }

  // 通用创建传感器的物理体
  protected createSensor(width: number, height: number, rotation: number = 0) {
    const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased()
      .setTranslation(this.x, this.y)
      .setRotation(rotation);

    rigidBodyDesc.setUserData(this);

    this.rigidBody = this.scene.rapierWorld.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2);
    colliderDesc.setSensor(true); // 设为传感器，不产生物理碰撞体积
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    colliderDesc.setActiveCollisionTypes(
      RAPIER.ActiveCollisionTypes.DEFAULT |
      RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC
    );

    this.scene.rapierWorld.createCollider(colliderDesc, this.rigidBody);
  }
}
