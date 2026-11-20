import { DamageConstants } from "../../../constants/game";
import { legacyRapierVelocityToUnitsPerSecond } from "../../../constants/physics";
import DepthHelper from "../../utils/helper/DepthHelper";
import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { PositionManager } from "../../managers/view/PositionManager";
import { BaseEntity } from "../../models/core/BaseEntity";
import { BulletEntity } from "../../models/projectiles/BulletEntity";
import { BulletConfig, BulletModel } from "../../models/projectiles/ProjectileModels";
import type { Game } from "../../scenes/Game";
import { CombatEntity } from "../../models/core/CombatEntity";
import { Faction } from "../../models/Enum";
import { CollisionContext } from "../../types";
import { ProjectileCmd } from "../../utils/cmd/ProjectileCmd";
import { LogicModel } from "../../core/logic/LogicModel";
import { registerProjectileModel } from "../../utils/cmd/ProjectileModelRegistry";

export interface MineCartStandConfig {
  onLost?: (row: number) => void;
}

export type MineCartConfig = BulletConfig;

export class MineCartModel extends BulletModel<MineCartConfig, MineCartEntity> {
  public static override readonly projectileKind: string = "minecart";
  texture = 'bullet/minecart';
  public speed = legacyRapierVelocityToUnitsPerSecond(600);
  public penetratePower = 999; // 无限穿透
  public penetratedPunish = 1.0; // 伤害不衰减

  public createEntity(scene: Game, x: number, row: number, config: MineCartConfig): MineCartEntity {
    return new MineCartEntity(scene, x, row, this, config);
  }
}

export const MineCartData = new MineCartModel();

class MineCartStandModel extends LogicModel {
  public row: number = -1;
  public hasTriggered: boolean = false;
}

export class MineCartStandEntity extends BaseEntity {
  public declare model: MineCartStandModel;
  public baseDepth: number;

  /** 回调只用于表现层通知，不进入快照。 */
  private readonly onLost?: (row: number) => void;
  private sprite!: Phaser.GameObjects.Sprite;

  constructor(scene: Game, x: number, row: number, cfg: MineCartStandConfig = {}) {
    super(scene, x, PositionManager.Instance.getRowCenterY(row), new MineCartStandModel());
    this.model.row = row;
    this.model.hasTriggered = false;
    this.onLost = cfg.onLost;
    this.baseDepth = DepthHelper.Projectile.bulletColumn(PositionManager.Instance.getColByX(x));

    this.buildView();
    this.buildPhysics();
    this.playSpawnSlide();
  }

  protected buildView(): void {
    const scaleFactor = PositionManager.Instance.scaleFactor;
    this.sprite = this.scene.add.sprite(this.x, this.y, MineCartData.texture);
    this.sprite.setDisplaySize(64 * scaleFactor, 64 * scaleFactor);
    this.sprite.setDepth(this.baseDepth);
    this.viewGroup.add(this.sprite);
  }

  public onCollision(ctx: CollisionContext): void {
    if (this.hasTriggered) {
      return;
    }
    if (!(ctx.targetEntity instanceof CombatEntity)) {
      return;
    }
    if (ctx.targetEntity.faction === Faction.PLANT) {
      return;
    }

    this.hasTriggered = true;
    this.launchMinecart();
    this.onLost?.(this.row);
    this.destroy();
  }

  private buildPhysics(): void {
    const bodySize = PositionManager.Instance.getBulletBodySize();
    const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(this.x, this.y);
    rigidBodyDesc.setUserData(this);

    this.rigidBody = this.scene.rapierWorld.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(bodySize.sizeX / 2, bodySize.sizeY / 2);
    colliderDesc.setSensor(true);
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    colliderDesc.setActiveCollisionTypes(
      RAPIER.ActiveCollisionTypes.DEFAULT |
      RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED
    );
    this.scene.rapierWorld.createCollider(colliderDesc, this.rigidBody);
  }

  private launchMinecart(): void {
    ProjectileCmd.Create(MineCartModel, this.scene, this.x, this.row, {
      damage: DamageConstants.SECKILL,
      faction: Faction.PLANT,
      maxDistance: PositionManager.Instance.Col_Number + 4,
      bounceable: false,
      tiny: true,
    });
  }

  private playSpawnSlide(): void {
    const startX = this.x - PositionManager.Instance.GRID_SIZEX * 0.75;
    this.sprite.setPosition(startX, this.y);
    this.scene.tweens.add({
      targets: this.sprite,
      x: this.x,
      duration: 260,
      ease: 'Cubic.easeOut',
    });
  }
}

export class MineCartEntity extends BulletEntity {
  constructor(scene: Game, x: number, row: number, model: MineCartModel, cfg: MineCartConfig) {
    super(scene, x, row, model, cfg);

    // 设置初始伤害
    this.currentDamage = DamageConstants.SECKILL;

    // 自定义大小
    const scaleFactor = PositionManager.Instance.scaleFactor;
    this.sprite.setDisplaySize(64 * scaleFactor, 64 * scaleFactor);
  }

  protected applyEffect(t: CombatEntity): void {
    super.applyEffect(t);
  }

  stepUpdate() {
    super.stepUpdate();

    // 超过屏幕边界销毁
    if (this.x > PositionManager.Instance.getWorldBounds().right) {
      console.log('minecart out of screen');
      this.destroy();
    }
  }
}

registerProjectileModel(MineCartModel.projectileKind, MineCartModel);
