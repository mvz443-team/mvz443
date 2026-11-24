/**
 * 弹性小兵 - 反弹敌方子弹，支持闪电增强
 */

import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { CollisionContext } from "../../../types";
import { Faction } from "../../../models/Enum";
import { isHostile } from "../../../core/logic/FactionRelations";

type BounceableProjectile = {
  faction: Faction;
  bounceable: boolean;
  reverseVelocityX(): void;
  catchEnhancement?: (enhancement: "lightning") => void;
};

export class ElasticPutinModel extends PlantModel {
  public override pid = 15;
  public override nameKey = 'name_elastic_putin';
  public override descriptionKey = 'elastic_putin_brief';
  public override texturePath = 'plant/elastic_putin';

  public maxHealth = new LevelScaledValue(300);
  public cost = new LevelScaledValue(100).setThreshold(3, 75);
  public cooldown = new LevelScaledValue(7500);
  public cooldownStartAtRatio = 0;
  public damage = new LevelScaledValue(0);
  public isNightPlant = true;

  public override createEntity(scene: Game, col: number, row: number, level: number): ElasticPutinEntity {
    return this.initializeEntity(new ElasticPutinEntity(scene, col, row, level));
  }

  public override onCreate(entity: ElasticPutinEntity): void {
    // 弹性小兵是被动单位，无需周期性检查
  }

  public override onStarShards(entity: ElasticPutinEntity): void {
    // 唤醒（如果在睡眠）
    entity.setSleeping(false);

    // 激活闪电效果
    const duration = entity.level >= 7 ? 8000 : 5000;
    this.activateLightning(duration);
  }

  /** 反弹判定与闪电附魔由 Model 决定；Entity 只负责物理速度反转与视图同步。 */
  public onCollision(entity: ElasticPutinEntity, target: unknown): boolean {
    if (entity.isSleeping) return false;
    if (!this.isBounceableProjectile(target)) return false;
    if (isHostile(entity, target)) return false;

    target.reverseVelocityX();
    if (this.isLightning) {
      target.catchEnhancement?.("lightning");
    }
    return true;
  }

  public activateLightning(duration: number): void {
    this.isLightning = true;
    this.tickmanager.delayedCall({
      delay: duration,
      callback: () => {
        if (this.health > 0) {
          this.isLightning = false;
        }
      },
    });
  }

  public canExtendSightLineFor(faction: Faction): boolean {
    // 只给"与己方非敌对"的射线延长视野；魅惑/PvP 改阵营后不再写死 PLANT。
    return this.health > 0 && !this.isSleeping && !isHostile(this, faction);
  }

  private isBounceableProjectile(target: unknown): target is BounceableProjectile {
    if (!target || typeof target !== "object") return false;
    const candidate = target as Partial<BounceableProjectile>;
    return typeof candidate.faction === "number"
      && candidate.bounceable === true
      && typeof candidate.reverseVelocityX === "function";
  }
}

export const ElasticPutinData = new ElasticPutinModel();

export class ElasticPutinEntity extends PlantEntity {
  public declare model: ElasticPutinModel;

  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, ElasticPutinData, level);
  }

  protected override buildView() {
    const size = PositionManager.Instance.getPlantDisplaySize();

    // frame 0
    const sprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth);

    this.viewGroup.add(sprite);
  }

  /**
   * 碰撞事件处理：反弹箭矢
   */
  public override onCollision(ctx: CollisionContext): void {
    this.model.onCollision(this, ctx.targetEntity);
  }

  /**
   * 激活闪电效果，持续指定时间
   */
  public activateLightning(duration: number): void {
    this.model.activateLightning(duration);
  }

  public canExtendSightLineFor(faction: Faction): boolean {
    return this.model.canExtendSightLineFor(faction);
  }

  public override destroy(): void {
    super.destroy();
  }
}

export default ElasticPutinData;
