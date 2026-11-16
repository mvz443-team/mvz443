import DepthHelper from "../../../utils/helper/DepthHelper";
import { PlantStat } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import SoundCmd from "../../../utils/cmd/SoundCmd";
import { PowderScatterSfx } from "../../../sfx/powder/PowderScatterSfx";


export class IceBombModel extends PlantModel {
  public override pid = 12;
  public override nameKey = 'name_ice_bomb';
  public override descriptionKey = 'ice_bomb_description';
  public override texturePath = 'plant/ice_bomb';

  public maxHealth = new PlantStat(600);
  public cost = new PlantStat(75);
  public cooldown = new PlantStat(52000).setThreshold(9, 41000); // 52秒 / 9级时41秒
  public cooldownStartAtRatio = 1; // 需要完整等待cooldown

  // 初始化伤害：1-4级 15伤害 * 2倍 = 30；5级以上 350伤害
  public damage = new PlantStat(15).setIncRatio(2).setThreshold(5, 350);
  private readonly freezeDurationMs = 8000;
  private readonly slowDurationMs = 5000;

  isNightPlant = true;

  constructor() {
    super();

  }

  onCreate(entity: IceBombEntity): void {
    entity.canActivateFromSleep = true;
    if (!entity.isSleeping) {
      this.shootLaser(entity);
    }
  }

  onSleepStateChange(entity: IceBombEntity, isSleeping: boolean): void {
    // 初始化时的光敏睡眠不触发；之后只有进入睡眠时才生效。
    if (isSleeping && entity.canActivateFromSleep) {
      this.shootLaser(entity);
    }
  }

  onStarShards(entity: IceBombEntity): void {
    if (entity.isSleeping) {
      this.shootLaser(entity);
    }
  }

  private shootLaser(entity: IceBombEntity): void {
    if (!entity.scene || entity.currentHealth <= 0) return;
    if (entity.hasTriggered) return;
    entity.hasTriggered = true;

    const scene = entity.scene as Game;
    const damageValue = this.damage.getValueAt(entity.level);

    SoundCmd.PlayPlant('freeze');

    // 触发视觉效果
    entity.playFreezeAnimation();

    // 第一次攻击：500ms后发射冻结激光
    entity.model.tickmanager.delayedCall({
      delay: 500,
      callback: () => {
        if (!entity || entity.currentHealth <= 0) return;

        entity.setVisible(false);
        console.log('frozen laser');

        // 发射隐藏的冻结激光到所有行
        for (let row = 0; row < PositionManager.Instance.Row_Number; row++) {
          ProjectileCmd.CreateLaser(
            scene, -1 * PositionManager.Instance.GRID_SIZEX, row, {
            damage: damageValue,
            duration: this.freezeDurationMs,
            distance: 12,
            debuff: 'frozen',
            debuffDuration: this.freezeDurationMs,
            couldAttackFlying: true,
            invisible: true,
            color: 0x00ffff,
            alphaFrom: 0,
            alphaTo: 0,
            faction: entity.faction,
          });
        }
      }
    });

    // 第二次攻击：冻结结束后发射减速激光
    entity.model.tickmanager.delayedCall({
      delay: 500 + this.freezeDurationMs,
      callback: () => {
        if (!entity || entity.currentHealth <= 0) return;

        // 发射隐藏的减速激光到所有行
        for (let row = 0; row < PositionManager.Instance.Row_Number; row++) {
          ProjectileCmd.CreateLaser(
            scene, -1 * PositionManager.Instance.GRID_SIZEX, row, {
            damage: damageValue,
            duration: this.slowDurationMs,
            distance: 12,
            debuff: 'slow',
            debuffDuration: this.slowDurationMs,
            couldAttackFlying: true,
            invisible: true,
            color: 0x00ffff,
            alphaFrom: 0,
            alphaTo: 0,
            faction: entity.faction,
          });

        }

        // 销毁自身
        entity.destroy();
      }
    });
  }

  public createEntity(scene: Game, col: number, row: number, level: number) {
    return this.initializeEntity(new IceBombEntity(scene, col, row, level));
  }
}

export class IceBombEntity extends PlantEntity {
  public canActivateFromSleep = false;
  public hasTriggered = false;

  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, IceBombData, level);
  }

  protected buildView() {
    const size = PositionManager.Instance.getPlantDisplaySize();

    const sprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth);

    this.viewGroup.add(sprite);
  }

  public playFreezeAnimation() {
    const posManager = PositionManager.Instance;
    SfxCmd.Create(PowderScatterSfx, {
      scene: this.scene,
      x: this.x,
      y: this.y,
      depth: DepthHelper.Plant.sfx(this.baseDepth),
      color: 0x0265b6,
      count: 20,
      rangeWidth: posManager.GRID_SIZEX * 1.5,
      rangeHeight: posManager.GRID_SIZEY * 1.5,
    });
  }
}

export const IceBombData = new IceBombModel();
