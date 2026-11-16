/**
 * 弹性小兵 - 反弹敌方子弹，支持闪电增强
 */

import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { CollisionContext } from "../../../types";
import { ArrowEntity } from "../../bullet/arrow";
import { Faction } from "../../../models/Enum";

export class ElasticPutinModel extends PlantModel {
  public override pid = 15;
  public override nameKey = 'name_elastic_putin';
  public override descriptionKey = 'elastic_putin_description';
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
    entity.activateLightning(duration);
  }
}

export const ElasticPutinData = new ElasticPutinModel();

export class ElasticPutinEntity extends PlantEntity {
  /** 闪电窗口影响命中结果，字段由 PLANT_LOGIC_SCHEMA 追踪。 */
  private declare isLightning: boolean;

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
    // 只反弹 ArrowEntity
    if (!(ctx.targetEntity instanceof ArrowEntity)) return;

    const arrow = ctx.targetEntity as ArrowEntity;

    // 只反弹自己的箭矢
    if (arrow.faction !== this.faction) return;

    // 如果箭矢不可反弹，则不反弹
    if (!arrow.bounceable) return;

    // 调用箭矢的反弹方法
    arrow.reverseVelocityX();

    // 如果激活了闪电效果，为箭矢施加增强
    if (this.isLightning && arrow instanceof ArrowEntity) {
      arrow.catchEnhancement('lightning');
    }
  }

  /**
   * 激活闪电效果，持续指定时间
   */
  public activateLightning(duration: number): void {
    this.isLightning = true;
    // 逻辑窗口必须用可快照的定时系统，不能用 scene.time：
    // scene.time 不进入快照，回滚后会出现"幽灵闪电"。
    this.model.tickmanager.delayedCall({
      delay: duration,
      callback: () => {
        if (this.currentHealth > 0) {
          this.isLightning = false;
        }
      },
    });
  }

  public canExtendSightLineFor(faction: Faction): boolean {
    return this.currentHealth > 0 && !this.isSleeping && this.faction === faction;
  }

  public override destroy(): void {
    super.destroy();
  }
}

export default ElasticPutinData;
