import DepthHelper from "../../../utils/helper/DepthHelper";
import ProjectileDamage from "../../../../constants/damage";
import { legacyRapierVelocityToUnitsPerSecond } from "../../../../constants/physics";
import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import createShootBurstAnim from "../../../sprite/shoot_anim";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import ShootHeadAnimationHelper from "../../../utils/helper/ShootHeadAnimationHelper";
import { ArrowModel } from "../../bullet/arrow";
import { SightLineEntity } from "../../../models/entities/SightLineEntity";


export class DispenserModel extends PlantModel {
  public override pid = 1;
  public override nameKey = 'name_dispenser';
  public override descriptionKey = 'dispenser_description';
  public override texturePath = 'plant/dispenser';

  public maxHealth = new LevelScaledValue(300);
  public cost = new LevelScaledValue(100).setThreshold(5, 75);
  public cooldown = new LevelScaledValue(6000);
  public cooldownStartAtRatio = 0; // 不需要等待，立即装填

  public damage = new LevelScaledValue(ProjectileDamage.bullet.arrow).setIncRatio(1.35);
  public penetratePower = new LevelScaledValue(1).setThreshold(3, 2);
  public starShardsPenetratePower = new LevelScaledValue(1).setThreshold(3, 2).setThreshold(5, 3);

  isNightPlant = false;

  onCreate(entity: DispenserEntity): void {
    const sightLine = new SightLineEntity(entity.scene, {
      owner: entity,
      row: () => entity.GetRow(),
      direction: 1,
      maxDistance: PositionManager.Instance.GRID_SIZEX * 32,
      excludeFactions: [entity.faction],
    });

    // 启动普通发射定时器
    entity.model.tickmanager.addEvent({
      startAt: 800,
      delay: 1000,
      repeat: -1,
      callback: () => {
        if (entity.isSleeping) return;
        if (entity.inBruteShoot) return; // 暴力发射中不执行普通发射逻辑
        if (sightLine.hasTarget()) {
          entity.playShootAnimation();
          entity.model.tickmanager.delayedCall({
            delay: 200,
            callback: () => {
              this.normalShot(entity.scene, entity);
            }
          })
        }
      }
    })
  }

  onSleepStateChange(entity: DispenserEntity, isSleeping: boolean): void {
    // 不用手动维护动画，因为动画的播放条件已经绑定睡眠状态了
  }

  onStarShards(entity: DispenserEntity): void {
    if (entity.inBruteShoot) return; // 已经在暴力发射中，避免重复触发
    entity.inBruteShoot = true;
    // 暴力发射
    this.bruteShot(entity.scene, entity, () => {
      entity.inBruteShoot = false;
    });
  }

  protected normalShot(scene: Game, entity: DispenserEntity, penetratePower = this.penetratePower.getValueAt(entity.level)) {
    ProjectileCmd.Create(
      ArrowModel, scene, entity.x, entity.row, {
      damage: this.damage.getValueAt(entity.level),
      faction: entity.faction,
      speed: legacyRapierVelocityToUnitsPerSecond(800),
      bounceable: true,
      dealer: entity,
      penetratePower,
    });
  }

  private bruteShot(scene: Game, entity: DispenserEntity, callback: () => void) {
    const totalArrows = 50; // 暴力发射的箭矢数量
    entity.playBruteShootAnimation(totalArrows);
    entity.model.tickmanager.addEvent({
      startAt: 200,
      delay: 50,
      repeat: totalArrows,
      callback: () => {
        this.normalShot(scene, entity, this.starShardsPenetratePower.getValueAt(entity.level));
      }
    });
    // 计算总持续时间：Tween 200ms + Timer 发射的时长
    const overallDuration = 200 + 50 * (totalArrows - 1);
    entity.model.tickmanager.delayedCall({
      delay: overallDuration,
      callback: () => {
        entity.recoverHeadPosition();
        callback();
      }
    });
  }

  public createEntity(scene: Game, col: number, row: number, level: number) {
    return this.initializeEntity(new DispenserEntity(scene, col, row, level));
  }
}

export class DispenserEntity extends PlantEntity {
  private declare headX: number;
  private declare head: Phaser.GameObjects.Sprite;

  inBruteShoot: boolean = false; // 是否处于暴力发射状态

  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, DispenserData, level);
  }

  protected buildView() {
    const size = PositionManager.Instance.getPlantDisplaySize();

    const base = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 1)
      .setOrigin(0.5, 1).setDisplaySize(size.sizeX, size.sizeY).setDepth(DepthHelper.Plant.dispenserBase(this.baseDepth));

    const head = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 2)
      .setOrigin(0.5, 1).setDisplaySize(size.sizeX, size.sizeY).setDepth(this.baseDepth);

    this.headX = this.x;
    this.head = head;
    this.viewGroup.addMultiple([base, head]);
  }

  public playShootAnimation() {
    if (this.currentHealth <= 0) return;

    const head = this.head;
    const moveDistance = head.displayWidth * 0.15;

    ShootHeadAnimationHelper.playRecoil(
      this.scene,
      head,
      this.headX,
      moveDistance,
      () => {
        if (this.currentHealth <= 0) return;
        createShootBurstAnim(this.scene, head.x + head.displayWidth * 4 / 9, head.y - head.displayHeight * 2 / 3, 24, DepthHelper.Plant.shootBurst(this.baseDepth));
      }
    );
  }

  public playBruteShootAnimation(_totalArrows: number) {
    if (this.currentHealth <= 0) return;

    const head = this.head;
    const moveDistance = head.displayWidth * 0.15;

    ShootHeadAnimationHelper.startHoldRecoil(this.scene, head, this.headX, moveDistance);
  }

  public recoverHeadPosition() {
    if (this.currentHealth <= 0) return;
    ShootHeadAnimationHelper.recover(this.scene, this.head, this.headX);
  }
}

export const DispenserData = new DispenserModel();
