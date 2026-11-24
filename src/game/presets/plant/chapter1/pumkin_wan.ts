import { LevelScaledValue } from "../../../../utils/numbervalue";
import ProjectileDamage from "../../../../constants/damage";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import { PumpkinData } from "./pumkin";
import ShootHeadAnimationHelper from "../../../utils/helper/ShootHeadAnimationHelper";
import { ExplosionConfig, LaserConfig } from "../../../models/projectiles/ProjectileModels";
import { SightLineGroup } from "../../../models/entities/SightLineEntity";
import SoundCmd from "../../../utils/cmd/SoundCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { PumpkinWanLaserSfx } from "../../../sfx/laser/PumpkinWanLaserSfx";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import type { JsonValue } from "../../../core/SimulationState";

const PUMPKIN_WAN_EVENTS = {
  BruteExplosion: "PumpkinWanBruteExplosion",
} as const;

/**
 * 南瓜头·晚上 - 夜间激光植物的升级版
 * 
 * 特点：
 * - 升级版南瓜头，替换基座植物
 * - 攻击更快，范围更近
 * - 以自身为中心向周围发射激光（3x3，9 级扩大到 5x5）
 * - 7级以上激光能攻击飞行单位
 * - 星屑能力发射连续爆炸
 */
export class PumpkinWanModel extends PlantModel {
  public override pid = 11;
  public override nameKey = 'name_pumpkin_wan';
  public override descriptionKey = 'pumpkin_wan_brief';
  public override texturePath = 'plant/pumpkin_wan';

  public maxHealth = new LevelScaledValue(425);
  public cost = new LevelScaledValue(300);
  public cooldown = new LevelScaledValue(52000);
  public cooldownStartAtRatio = 0; // 不需要初始冷却

  public damage = new LevelScaledValue(ProjectileDamage.laser.heavy_laser).setIncRatio(1.35);
  public isNightPlant = true;

  /** 高级植物：必须种在阴森南瓜头（pid 9）的基座上。 */
  public override requiredBasePid = PumpkinData.pid;

  /** 星碎爆炸队列；即使植物死亡，也要把已排队的爆炸执行完。 */
  public pendingBruteExplosions = 0;
  public disposeAfterBruteExplosions = false;

  LevelThresholds1 = 5; // 激光能攻击飞行单位的等级阈值
  LevelThresholds2 = 9; // 激光范围增加的等级阈值

  public override get tickEventNames(): readonly string[] {
    return [
      ...DEFAULT_TICK_EVENT_NAMES,
      PUMPKIN_WAN_EVENTS.BruteExplosion,
    ];
  }

  // 攻击参数
  private readonly attackDistance = new LevelScaledValue(3).setThreshold(this.LevelThresholds2, 5); // 格子数（比基础版短）
  private readonly startOffset = new LevelScaledValue(1.5).setThreshold(this.LevelThresholds2, 2.5); // 格子数
  private readonly dpsReferenceAttackInterval = 1550; // 旧版攻击间隔，用于保持总 DPS 不变
  private readonly baseAttackInterval = new LevelScaledValue(500); // 忧郁蘑菇式高频脉冲


  // 激光参数
  private readonly laserDuration = 260; // 高频脉冲下激光表现需要更短促

  onCreate(entity: PumpkinWanEntity): void {
    // 设置最大血量和当前血量
    entity.maxHealth = this.maxHealth.getValueAt(entity.level);
    entity.currentHealth = entity.maxHealth;
    entity.updateDisplayFrame();

    // 启动周期性激光发射
    const attackInterval = this.baseAttackInterval.getValueAt(entity.level);
    const canAttackFlying = entity.level >= this.LevelThresholds1;
    const sightLine = new SightLineGroup(entity.scene, {
      owner: entity,
      row: () => entity.row,
      rowOffsets: this.getRowOffsets(entity.level),
      originX: () => entity.x - this.startOffset.getValueAt(entity.level) * PositionManager.Instance.GRID_SIZEX,
      direction: 1,
      maxDistance: this.attackDistance.getValueAt(entity.level) * PositionManager.Instance.GRID_SIZEX,
      excludeSelf: true,
      reach: { tiny: true, flying: canAttackFlying },
      ignoreBounce: true,
    });

    entity.model.tickmanager.addEvent({
      startAt: attackInterval / 2, // 第一次攻击延迟
      delay: attackInterval,
      repeat: -1,
      callback: () => {
        if (entity.isSleeping) return;

        // 检查三行任意有敌人
        if (sightLine.hasTarget()) {
          entity.playAttackAnimation();
          this.normalShot(entity.scene, entity, attackInterval);
        }
      }
    });
  }

  onSleepStateChange(_entity: PumpkinWanEntity, _isSleeping: boolean): void {
    // 定时器会在 callback 中检查 isSleeping 状态，无需手动维护
  }

  onStarShards(entity: PumpkinWanEntity): void {
    if (entity.currentHealth <= 0) return;

    // 触发连续爆炸大招
    this.pendingBruteExplosions = 5;
    this.bruteShot(entity.scene, entity);
  }

  /**
   * 普通发射：以自身为中心的矩形范围激光
   */
  private normalShot(scene: Game, entity: PumpkinWanEntity, attackInterval: number): void {
    const level = entity.level;
    const damage = this.getPulseDamage(level, attackInterval);

    // 根据等级调整激光起始位置和距离
    const startOffset = this.startOffset.getValueAt(level);
    const laserDistance = this.attackDistance.getValueAt(level);
    const canAttackFlying = level >= this.LevelThresholds1;
    const visualLaserLength = this.getVisualLaserLength(level);

    const startX = entity.x - startOffset * PositionManager.Instance.GRID_SIZEX;

    SfxCmd.Create(PumpkinWanLaserSfx, {
      scene,
      x: entity.x,
      y: entity.y - PositionManager.Instance.getPlantDisplaySize().sizeY * 0.52,
      row: entity.row,
      lengthGrid: visualLaserLength,
      duration: this.laserDuration,
    });
    SoundCmd.PlayShootLaser();

    // 物理体按行拆成独立激光，视觉由中心放射效果承担。
    for (const rowOffset of this.getRowOffsets(level)) {
      const targetRow = entity.row + rowOffset;
      if (targetRow >= 0 && targetRow < PositionManager.Instance.getRowCount()) {
        const laserConfig: LaserConfig = {
          damage,
          faction: entity.faction,
          dealer: entity,
          duration: this.laserDuration,
          distance: laserDistance,
          flying: canAttackFlying,
          invisible: true,
          color: 0x7df7ff,
          alphaFrom: 0,
          alphaTo: 0,
        };

        ProjectileCmd.CreateLaser(scene, startX, targetRow, laserConfig);
      }
    }
  }

  /** 攻击覆盖行：默认上下各 1 行（3x3），9 级上下各 2 行（5x5）。 */
  public getRowOffsets(level: number): number[] {
    return level >= this.LevelThresholds2
      ? [-2, -1, 0, 1, 2]
      : [-1, 0, 1];
  }

  private getVisualLaserLength(level: number): number {
    const startOffset = this.startOffset.getValueAt(level);
    const laserDistance = this.attackDistance.getValueAt(level);
    return Math.max(startOffset, laserDistance - startOffset) + 0.18;
  }

  private getPulseDamage(level: number, attackInterval: number): number {
    const oldHitDamage = this.damage.getValueAt(level);
    return Number((oldHitDamage * attackInterval / this.dpsReferenceAttackInterval).toFixed(3));
  }

  /**
   * 大招：连续爆炸
   */
  private bruteShot(scene: Game, entity: PumpkinWanEntity): void {
    const totalExplosions = 5;

    entity.playBruteShootAnimation(totalExplosions);

    // 首次在 1800ms（2000 - startAt 200），之后每 2000ms 一次，共 5 次。
    this.tickmanager.schedule(PUMPKIN_WAN_EVENTS.BruteExplosion, 2000, {
      startAt: 200,
      repeat: totalExplosions,
    });
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === PUMPKIN_WAN_EVENTS.BruteExplosion) {
      this.bruteExplosion();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private bruteExplosion(): void {
    const entity = this.host as PumpkinWanEntity | null;
    if (!entity) return;

    const explosionConfig: ExplosionConfig = {
      damage: 275,
      faction: entity.faction,
      dealer: entity,
      upGrid: 1,
      leftGrid: 1.5,
      rightGrid: 1.5,
    };
    entity.createExplosion(explosionConfig as unknown as Record<string, unknown>);

    this.pendingBruteExplosions = Math.max(0, this.pendingBruteExplosions - 1);
    if (this.pendingBruteExplosions === 0 && this.disposeAfterBruteExplosions) {
      this.disposeAfterBruteExplosions = false;
      super.disposeTickManager();
    }
  }

  public override disposeTickManager(): void {
    // 死亡后仍要完成星碎的持续爆炸；最后一次爆炸结束后再真正释放定时器。
    if (this.pendingBruteExplosions > 0) {
      this.disposeAfterBruteExplosions = true;
      return;
    }
    super.disposeTickManager();
  }

  public createEntity(scene: Game, col: number, row: number, level: number): PumpkinWanEntity {
    // 基座替换与睡眠继承由 PlantHelper.CreateEntityWithBaseReplacement 统一处理。
    return this.initializeEntity(new PumpkinWanEntity(scene, col, row, level));
  }
}

/**
 * PumpkinWanEntity - 南瓜头·晚上的实体表现层
 */
export class PumpkinWanEntity extends PlantEntity {
  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, PumpkinWanData, level);
  }

  protected buildView(): void {
    const size = PositionManager.Instance.getPlantDisplaySize();

    const sprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth);
    sprite.setData('baseScaleX', sprite.scaleX);
    sprite.setData('baseScaleY', sprite.scaleY);

    this.viewGroup.add(sprite);
  }

  /**
   * 普通攻击动画（发射激光时）
   */
  public playAttackAnimation(): void {
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite;
    if (!sprite) return;

    sprite.setFrame(1);
    const baseScaleX = (sprite.getData('baseScaleX') as number | undefined) ?? sprite.scaleX;
    const baseScaleY = (sprite.getData('baseScaleY') as number | undefined) ?? sprite.scaleY;
    this.scene.tweens.killTweensOf(sprite);
    sprite.setScale(baseScaleX, baseScaleY);
    this.scene.tweens.add({
      targets: sprite,
      scaleX: baseScaleX * 1.04,
      scaleY: baseScaleY * 0.96,
      duration: 70,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => sprite.setScale(baseScaleX, baseScaleY),
    });

    // 高频脉冲只短暂闪帧，避免一直停在攻击帧。
    this.scene.time.delayedCall(150, () => {
      if (this && this.currentHealth > 0 && sprite) {
        sprite.setFrame(0);
      }
    });
  }

  /**
   * 大招动画（爆炸发射时）
   */
  public playBruteShootAnimation(_totalExplosions: number): void {
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite;
    if (!sprite) return;

    // 头部向左缩进
    this.scene.tweens.add({
      targets: sprite,
      x: this.x - sprite.displayWidth * 0.1,
      duration: 200,
      ease: 'Sine.easeOut'
    });

    // 总持续时间：1800 + 2000 * 4 = 9800ms
    const totalDuration = 1800 + 2000 * 4;
    this.scene.time.delayedCall(totalDuration, () => {
      if (sprite && this.currentHealth > 0) {
        ShootHeadAnimationHelper.recover(this.scene, sprite, this.x);
      }
    });
  }

  /**
   * 更新显示帧
   */
  public updateDisplayFrame(): void {
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite;
    if (!sprite) return;

    sprite.setFrame(this.currentHealth > 0 ? 0 : 0);
  }
}

export const PumpkinWanData = new PumpkinWanModel();
