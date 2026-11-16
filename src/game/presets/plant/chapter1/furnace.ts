import { PlantStat } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { GainEnergySfx, GainEnergySfxSize } from "../../../sfx/energy/GainEnergySfx";
import ResourceCmd from "../../../utils/cmd/ResourceCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";


export class FurnaceModel extends PlantModel {
  public override pid = 2;
  public override nameKey = 'name_furnace';
  public override descriptionKey = 'furnace_description';
  public override texturePath = 'plant/furnace';

  public maxHealth = new PlantStat(300);
  public cost = new PlantStat(50).setThreshold(5, 35);
  public cooldown = new PlantStat(6000);
  public cooldownStartAtRatio = 0;

  generateEnergyCooldown = new PlantStat(25000).setDecValue(0.85); // 生成能量的冷却时间，随等级增加而递减
  generateEnergyAmount = new PlantStat(25).setThreshold(9, 40); // 生成能量的数量，9级时提升
  public damage = new PlantStat(0); // 炉子没有伤害

  isNightPlant = false;

  onCreate(entity: FurnaceEntity): void {
    // 启动能量生产定时器
    const cooldownTime = this.generateEnergyCooldown.getValueAt(entity.level);

    entity.model.tickmanager.addEvent({
      startAt: cooldownTime * 0.7,
      delay: cooldownTime,
      repeat: -1,
      callback: () => {
        if (entity.isSleeping) return;
        if (entity.currentHealth > 0 && entity.scene && entity.scene.time) {
          entity.playGenerateAnimation();
          this.playGainEnergySfx(entity, "medium", true);
          const energyToAdd = this.generateEnergyAmount.getValueAt(entity.level);
          ResourceCmd.AddEnergyToAll(energyToAdd);
        }
      }
    });
  }

  onStarShards(entity: FurnaceEntity): void {
    this.playGainEnergyBurstSfx(entity);
    // 一次性加能量
    ResourceCmd.AddEnergyToAll(450);
  }

  public createEntity(scene: Game, col: number, row: number, level: number) {
    return this.initializeEntity(new FurnaceEntity(scene, col, row, level));
  }

  private playGainEnergyBurstSfx(entity: FurnaceEntity): void {
    for (let i = 0; i < 5; i += 1) {
      entity.scene.time.delayedCall(i * 160, () => {
        if (entity.currentHealth <= 0) {
          return;
        }
        this.playGainEnergySfx(entity, "large", false);
      });
    }
  }

  private playGainEnergySfx(entity: FurnaceEntity, size: GainEnergySfxSize, exactCenter: boolean): void {
    const center = this.getEnergySfxCenter(entity);

    SfxCmd.Create(GainEnergySfx, {
      scene: entity.scene,
      x: center.x,
      y: center.y,
      size,
      exactCenter,
    });
  }

  private getEnergySfxCenter(entity: FurnaceEntity): { x: number; y: number } {
    return {
      x: entity.x,
      y: entity.y - PositionManager.Instance.GRID_SIZEY * 0.55,
    };
  }
}

export class FurnaceEntity extends PlantEntity {
  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, FurnaceData, level);
  }

  protected buildView() {
    const size = PositionManager.Instance.getPlantDisplaySize();

    const sprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(this.baseDepth);

    this.viewGroup.add(sprite);
  }

  public playGenerateAnimation() {
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite;
    if (!sprite) return;

    // 切换帧到生成状态
    sprite.setFrame(1);

    // 1秒后恢复
    this.scene.time.delayedCall(
      1000,
      () => {
        if (this && this.currentHealth && this.currentHealth > 0) {
          sprite.setFrame(0);
        }
      });
  }
}

export const FurnaceData = new FurnaceModel();
