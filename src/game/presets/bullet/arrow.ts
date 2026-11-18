import DepthHelper from "../../utils/helper/DepthHelper";
import { legacyRapierVelocityToUnitsPerSecond } from "../../../constants/physics";
import { PositionManager } from "../../managers/view/PositionManager";
import { BulletEntity } from "../../models/projectiles/BulletEntity";
import { BulletConfig, BulletModel } from "../../models/projectiles/ProjectileModels";
import type { Game } from "../../scenes/Game";
import { _TypeArrowEnhancement, EnhancementPriority } from "../../../constants/game";
import { CombatEntity } from "../../models/core/CombatEntity";
import { ProjectileCmd } from "../../utils/cmd/ProjectileCmd";
import SoundCmd from "../../utils/cmd/SoundCmd";
import type { ModelHost } from "../../core/logic/LogicModel";
import { registerProjectileModel } from "../../utils/cmd/ProjectileModelRegistry";

export interface ArrowConfig extends BulletConfig {
  enhancement?: _TypeArrowEnhancement;
}

export class ArrowModel extends BulletModel<ArrowConfig, ArrowEntity> {
  public static override readonly projectileKind: string = "arrow";
  texture = 'bullet/arrow';

  /** 附魔直接定义在 Model 上，自动进入快照。 */
  public enhancement: _TypeArrowEnhancement = 'none';

  /** 箭矢命中效果由 Model 计算，Entity 不写战斗逻辑。 */
  public override applyEffect(host: ModelHost, target: unknown): void {
    const originalDamage = this.currentDamage;
    if (this.enhancement === 'fire') {
      this.currentDamage = Math.floor(this.currentDamage * 1.5);
    }

    if (this.enhancement === 'lightning') {
      host.createExplosion({
        damage: Math.ceil(this.currentDamage / 4),
        rightGrid: 1,
        leftGrid: 1,
        upGrid: 1,
        faction: host.faction,
        dealer: host.dealer ?? null,
      });
      host.setEnhancement?.('none');
    }

    super.applyEffect(host, target);

    this.currentDamage = originalDamage;

    if (this.enhancement === 'ice') {
      host.applyDebuffTo(target, 'slow', 5000);
    }
  }

  public createEntity(scene: Game, x: number, row: number, config: ArrowConfig): ArrowEntity {
    return new ArrowEntity(scene, x, row, this, config);
  }
}

export class ArrowEntity extends BulletEntity {
  public declare model: ArrowModel;
  /** 纯表现：尾迹精灵不进入快照。附魔状态在 Model 上。 */
  private trail: Phaser.GameObjects.Sprite | null = null;

  constructor(scene: Game, x: number, row: number, model: ArrowModel, cfg: ArrowConfig) {
    super(scene, x, row, model, cfg);
    this.model.enhancement = cfg.enhancement ?? 'none';

    // 1. 覆盖默认的视觉缩放 (宽度翻倍，高度减半)
    const size = PositionManager.Instance.getBulletDisplaySize();
    this.sprite.setDisplaySize(size.sizeX * 2, size.sizeY / 2);

    // 2. 播放专属音效
    SoundCmd.PlayShootArrow();

    // 3. 初始化附魔动画
    if (cfg.enhancement && cfg.enhancement !== 'none') {
      this.catchEnhancement(cfg.enhancement);
    }
  }

  // 实现附魔方法：建立或更新附魔动画
  public catchEnhancement(newEnhancement: _TypeArrowEnhancement): void {
    const scene = this.scene;
    if (!scene) return;

    // 1. 动画定义（仅首次）
    if (!scene.anims.exists('fire_trail')) {
      scene.anims.create({
        key: 'fire_trail',
        frames: scene.anims.generateFrameNumbers('anime/fire', { start: 0, end: 31 }),
        duration: 1000,
        repeat: -1,
      });
    }

    if (!scene.anims.exists('lightning_trail')) {
      scene.anims.create({
        key: 'lightning_trail',
        frames: scene.anims.generateFrameNumbers('anime/lightning_trail', { start: 0, end: 7 }),
        duration: 1000,
        repeat: -1,
      });
    }

    if (!scene.anims.exists('ice_trail')) {
      scene.anims.create({
        key: 'ice_trail',
        frames: scene.anims.generateFrameNumbers('anime/ice_trail', { start: 0, end: 7 }),
        duration: 1000,
        repeat: -1,
      });
    }

    // 2. 如果新 enhancement 与当前一致，则无需重复处理
    // 2.5 判断enhancement的优先级，如果原先的优先级更高，那么也无需处理
    if (this.model.enhancement === newEnhancement ||
      EnhancementPriority(this.model.enhancement, newEnhancement)) {
      return;
    }

    // 3. 旧 trail 淡出并销毁
    if (this.trail) {
      const oldTrail = this.trail;
      scene.tweens.add({
        targets: oldTrail,
        alpha: 0,
        duration: 800,
        ease: 'Linear',
        onComplete: () => oldTrail.destroy(),
      });
      this.trail = null;
    }

    this.model.enhancement = newEnhancement;
    const trailDepth = DepthHelper.Projectile.trail(this.baseDepth);
    const fadeDur = 100;

    // 4. 新 trail 淡入
    switch (this.model.enhancement) {
      case 'fire': {
        const spr = scene.add.sprite(this.x, this.y, 'anime/fire')
          .setScale(PositionManager.Instance.scaleFactor)
          .setOrigin(0.5, 1)
          .setDepth(trailDepth)
          .setAlpha(0)
          .play('fire_trail');

        spr.anims.timeScale = 0.5;
        // 将尾迹加入 viewGroup，这样会自动跟随实体位置更新
        this.viewGroup.add(spr);

        scene.tweens.add({
          targets: spr,
          alpha: 1,
          duration: fadeDur,
          ease: 'Linear',
        });

        this.trail = spr;
        break;
      }
      case 'lightning': {
        const img = scene.add.sprite(this.x, this.y, 'anime/lightning_trail')
          .setScale(PositionManager.Instance.scaleFactor)
          .setOrigin(0.5, 1)
          .setDepth(trailDepth)
          .setAlpha(0)
          .play('lightning_trail');

        // 将尾迹加入 viewGroup，这样会自动跟随实体位置更新
        this.viewGroup.add(img);

        scene.tweens.add({
          targets: img,
          alpha: 1,
          duration: fadeDur,
          ease: 'Linear',
        });
        this.trail = img;
        break;
      }
      case 'ice': {
        const img = scene.add.sprite(this.x, this.y, 'anime/ice_trail')
          .setScale(PositionManager.Instance.scaleFactor)
          .setOrigin(0.5, 1)
          .setDepth(trailDepth)
          .setAlpha(0)
          .play('ice_trail');

        // 将尾迹加入 viewGroup，这样会自动跟随实体位置更新
        this.viewGroup.add(img);

        scene.tweens.add({
          targets: img,
          alpha: 1,
          duration: fadeDur,
          ease: 'Linear',
        });
        this.trail = img;
        break;
      }
    }
  }

  private syncTrailPosition(): void {
    if (!this.trail) return;

    const velocityX = this.rigidBody?.linvel().x ?? 0;
    const facingLeft = Math.abs(velocityX) > 0.01 ? velocityX < 0 : this.sprite.flipX;
    const headOffsetX = this.sprite.displayWidth * 0.42 * (facingLeft ? -1 : 1);

    this.trail.setPosition(this.sprite.x + headOffsetX, this.sprite.y);
    this.trail.setFlipX(facingLeft);
  }

  public override updateRenderPosition(alpha: number): void {
    super.updateRenderPosition(alpha);
    this.syncTrailPosition();
  }

  public override updateView(vec: { x: number; y: number }, rotation?: number): void {
    super.updateView(vec, rotation);
    this.syncTrailPosition();
  }

  public override stepMove(alpha: number): void {
    super.stepMove(alpha);
    this.syncTrailPosition();
  }

  /** Model 在 lightning 触发后清除附魔，这里同步表现。 */
  public override setEnhancement(value: string): void {
    this.catchEnhancement(value as _TypeArrowEnhancement);
  }

  // 销毁时清理尾迹（Model 的 onDestroy 负责战斗效果）
  destroy(): void {
    // 清理尾迹（viewGroup 会在 super.destroy() 中统一销毁）
    this.trail = null;

    super.destroy();
  }
}

// ========================================
// MutantYAxisArrow - 可以沿Y轴运动到目标行的箭矢
// ========================================

/**
 * MutantYAxisArrow 配置
 * 当箭矢到达指定 targetRow 时，取消 Y 方向速度，只向前移动
 */
export interface MutantYAxisArrowConfig extends ArrowConfig {
  targetRow?: number; // 目标行，默认为起始行
  ySpeed?: number;    // Y 方向速度，单位：像素/帧
}

export class MutantYAxisArrowModel extends ArrowModel {
  public static override readonly projectileKind: string = "mutant_y_axis_arrow";
  public override texture = 'bullet/arrow';

  /** Y 轴拦截弹道状态直接定义在 Model。 */
  public targetRow: number = -1;
  public targetY: number = 0;
  public ySpeed: number = 0;
  public hasReachedTargetY: boolean = false;
  public lowerOrUpper: boolean = false;

  public createEntity(scene: Game, x: number, row: number, config: MutantYAxisArrowConfig): MutantYAxisArrowEntity {
    return new MutantYAxisArrowEntity(scene, x, row, this, config);
  }
}

export class MutantYAxisArrowEntity extends ArrowEntity {
  public declare model: MutantYAxisArrowModel;

  constructor(scene: Game, x: number, row: number, model: MutantYAxisArrowModel, cfg: MutantYAxisArrowConfig) {
    super(scene, x, row, model, cfg);
    const state = this.model;
    state.hasReachedTargetY = false;
    state.targetRow = cfg.targetRow ?? row;
    state.targetY = PositionManager.Instance.getRowCenterY(state.targetRow);
    state.lowerOrUpper = state.targetRow < row;
    state.ySpeed = cfg.ySpeed ?? legacyRapierVelocityToUnitsPerSecond(200);

    if (this.rigidBody) {
      const currentVel = this.rigidBody.linvel();
      const newYVel = state.lowerOrUpper ? -state.ySpeed : state.ySpeed;
      this.rigidBody.setLinvel({ x: currentVel.x, y: newYVel }, true);
    }
  }

  public override stepUpdate() {
    // 检查是否到达目标 row
    const state = this.model;
    if (this.rigidBody && !state.hasReachedTargetY) {
      if (state.lowerOrUpper) {
        if (this.y <= state.targetY) {
          this.rigidBody.setLinvel({ x: this.rigidBody.linvel().x, y: 0 }, true);
          this.y = state.targetY;
          state.hasReachedTargetY = true;
        }
      } else if (this.y >= state.targetY) {
        this.rigidBody.setLinvel({ x: this.rigidBody.linvel().x, y: 0 }, true);
        this.y = state.targetY;
        state.hasReachedTargetY = true;
      }
    }

    // 调用父类的 stepUpdate
    super.stepUpdate();
  }
}

registerProjectileModel(ArrowModel.projectileKind, ArrowModel);
registerProjectileModel(MutantYAxisArrowModel.projectileKind, MutantYAxisArrowModel);
