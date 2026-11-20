import { _Typedebuffs } from "../../../constants/game";
import DepthHelper from "../../utils/helper/DepthHelper";
import { PositionManager } from "../../managers/view/PositionManager";
import type { Game } from "../../scenes/Game";
import { CollisionContext } from "../../types";
import PlantHelper from "../../utils/helper/PlantHelper";
import { CombatEntity } from "../core/CombatEntity";
import { PlantEntity } from "../entities/PlantEntity";
import { ProjectileEntity } from "../entities/ProjectileEntity";
import { BulletConfig, BulletModel } from "./ProjectileModels";

export class BulletEntity extends ProjectileEntity<BulletModel> {
  /** 逻辑字段全部在 Model 上；Entity 只保留视图与物理胶水。 */
  public baseDepth: number;
  hasPenetratedSet: Set<CombatEntity> = new Set();
  public sprite!: Phaser.GameObjects.Sprite;

  private prevRenderX: number;
  private prevRenderY: number;
  private currentRenderX: number;
  private currentRenderY: number;

  constructor(scene: Game, x: number, row: number, model: BulletModel, cfg: BulletConfig) {
    const y = PositionManager.Instance.getRowCenterY(row);
    super(scene, x, y, model, cfg);
    this.currentDamage = cfg.damage;
    this.bounceable = cfg.bounceable ?? true;

    this.traveledDistanceX = 0;
    this.prevX = x;
    this.maxDistanceX = (cfg.maxDistance ?? 128) * PositionManager.Instance.GRID_SIZEX;
    this.speed = cfg.speed ?? model.speed;

    this.prevRenderX = x;
    this.prevRenderY = y;
    this.currentRenderX = x;
    this.currentRenderY = y;

    this.currentPenetrate = 0;
    this.hasPenetratedSet = new Set<CombatEntity>();
    this.penetratePower = cfg.penetratePower ?? model.penetratePower;
    this.penetratedPunish = cfg.penetratedPunish ?? model.penetratedPunish;

    // Visuals
    const col = PositionManager.Instance.getColByX(x);
    this.baseDepth = DepthHelper.Projectile.bulletColumn(col);
    this.sprite = scene.add.sprite(this.x, this.y, model.texture);
    const size = PositionManager.Instance.getBulletDisplaySize();
    this.sprite.setDisplaySize(size.sizeX, size.sizeY);
    this.sprite.setDepth(this.baseDepth);
    this.viewGroup.add(this.sprite);

    // Physics
    const bodySize = PositionManager.Instance.getBulletBodySize();
    this.createSensor(bodySize.sizeX, bodySize.sizeY);

    // Initial velocity
    this.rigidBody?.setLinvel({ x: this.speed, y: 0 }, true);
  }

  buildView() { }

  public override updateView(vec: { x: number; y: number }, rotation?: number): void {
    this.prevRenderX = this.currentRenderX;
    this.prevRenderY = this.currentRenderY;
    this.currentRenderX = vec.x;
    this.currentRenderY = vec.y;

    this.x = vec.x;
    this.y = vec.y;

    if (rotation !== undefined) {
      this.sprite.setRotation(rotation);
    }
  }

  stepUpdate() {
    super.stepUpdate();

    // Destroy if it leaves the world bounds.
    const bounds = PositionManager.Instance.getWorldBounds();
    if (this.x > bounds.right || this.x < bounds.left ||
      this.y > bounds.bottom || this.y < bounds.top) {
      this.destroy();
      return;
    }

    // Destroy if it exceeds the max travel distance.
    const deltaX = Math.abs(this.x - this.prevX);
    this.traveledDistanceX += deltaX;
    this.prevX = this.x;
    if (this.traveledDistanceX >= this.maxDistanceX) {
      this.destroy();
      return;
    }

    // Flip sprite based on horizontal velocity.
    if (this.rigidBody) {
      const vx = this.rigidBody.linvel().x;
      this.sprite.setFlipX(vx < 0);
    }
  }

  public override updateRenderPosition(alpha: number): void {
    const x = Phaser.Math.Linear(this.prevRenderX, this.currentRenderX, alpha);
    const y = Phaser.Math.Linear(this.prevRenderY, this.currentRenderY, alpha);
    this.sprite.setPosition(x, y);
  }

  public override stepMove(alpha: number): void {
    this.updateRenderPosition(alpha);
  }

  // Reverse horizontal velocity after a bounce.
  public reverseVelocityX(): void {
    if (!this.bounceable) return;
    if (this.rigidBody) {
      const vel = this.rigidBody.linvel();
      this.rigidBody.setLinvel({ x: -vel.x, y: vel.y }, true);
    }
  }

  public override hasPenetrated(target: unknown): boolean { return this.hasPenetratedSet.has(target as CombatEntity); }
  public override markPenetrated(target: unknown): void { this.hasPenetratedSet.add(target as CombatEntity); }

  // Override collision handling to support piercing and priority logic.
  override onCollision(ctx: CollisionContext): void {
    // Only combat entities can be hit.
    if (!(ctx.targetEntity instanceof CombatEntity)) return;

    // Basic filtering.
    if (!ctx.targetEntity.takeDamage) return;
    if (this.hasAttackedSet.has(ctx.targetEntity)) return;
    if (ctx.targetEntity.faction === this.faction) return;

    // Height / flying / void filters：统一走 Model 的体态判定。
    if (!this.model.canHit(ctx.targetEntity)) return;

    // Piercing rules.
    const target = ctx.targetEntity as CombatEntity;
    if (this.hasPenetratedSet.has(target) ||
      this.currentPenetrate > this.penetratePower) return;

    // Recursively pierce the highest-priority plant in the same cell.
    const penetrateHighestPriorityPlant = (plants: PlantEntity[], currentTarget: PlantEntity): void => {
      if (this.hasPenetratedSet.has(currentTarget) ||
        this.currentPenetrate > this.penetratePower) {
        return;
      }

      this.model.applyEffect(this, currentTarget);

      if (this.currentPenetrate > this.penetratePower) {
        this.destroy();
        return;
      }

      const nextTarget = plants.find(
        plant => plant !== currentTarget &&
          !this.hasPenetratedSet.has(plant) &&
          PlantHelper.IsMorePriorityPlant(plant, currentTarget),
      );

      if (nextTarget) {
        penetrateHighestPriorityPlant(plants, nextTarget);
      }
    };

    if (target instanceof PlantEntity) {
      const row = target.row;
      const col = target.col;
      // 同格穿透同样要遵守体态规则：打不到的低矮/飞行目标不能被顺带命中。
      const plants = PlantHelper.GetPlantsInGrid(col, row).filter((plant) => this.model.canHit(plant));

      penetrateHighestPriorityPlant(plants, target);
      return;
    }

    this.model.applyEffect(this, target);
    return;
  }
}
