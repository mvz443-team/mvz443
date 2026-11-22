import { LevelScaledValue } from "../../../../utils/numbervalue";
import PlantsManager from "../../../managers/combat/PlantsManager";
import ResourceManager from "../../../managers/combat/ResourceManager";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { BaseEntity } from "../../../models/core/BaseEntity";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";
import { DEFAULT_TICK_EVENT_NAMES, TickEventNameEnums } from "../../../core/logic/TickEvents";
import { getAuthoritativeFrame } from "../../../core/logic/EntityTickManager";
import type { JsonValue } from "../../../core/SimulationState";

export class GeneratorModel extends PlantModel {
  public visualFrameUntilFrame = 0;
  public visualFrameValue = 0;

  public override pid = 8;
  public override nameKey = 'name_generator';
  public override descriptionKey = 'generator_description';
  public override texturePath = 'plant/generator';

  public maxHealth = new LevelScaledValue(800).setIncRatio(1.2);
  public cost = new LevelScaledValue(50);
  public cooldown = new LevelScaledValue(32000); // 32秒
  public cooldownStartAtRatio = 0;
  public damage = new LevelScaledValue(0); // 生成器没有伤害

  LevelThresholds1 = 3;
  LevelThresholds2 = 7;

  // 夜间植物标记
  isNightPlant = true;

  public override get tickEventNames(): readonly string[] {
    return [
      ...DEFAULT_TICK_EVENT_NAMES,
      TickEventNameEnums.GeneratorResetVisualFrame,
    ];
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === TickEventNameEnums.GeneratorResetVisualFrame) {
      this.visualFrameUntilFrame = 0;
      this.visualFrameValue = 0;
      (this.host as GeneratorEntity | null)?.syncViewFromModel();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private scheduleVisualFlash(entity: GeneratorEntity, durationMs: number): void {
    this.visualFrameValue = 1;
    this.visualFrameUntilFrame = getAuthoritativeFrame() + Math.max(1, Math.ceil(durationMs / 50));
    entity.syncViewFromModel();
    this.tickmanager.delayedCall({
      delay: durationMs,
      callback: () => {
        this.visualFrameValue = 0;
        this.visualFrameUntilFrame = 0;
        (this.host as GeneratorEntity | null)?.syncViewFromModel();
      },
      snapshot: { kind: TickEventNameEnums.GeneratorResetVisualFrame, args: {} },
    });
  }

  onHurt(entity: GeneratorEntity, damage: number, realDamage: number, dealer?: BaseEntity): void {
    // 累计伤害，每20点伤害产生能量
    this.damagedSum += damage;
    let energyToAdd = 0;

    while (this.damagedSum >= 20) {
      this.damagedSum -= 20;

      // 根据等级和睡眠状态计算产生的能量
      let energy = 5;
      if (entity.isSleeping) {
        // 睡眠时产能减少（光敏作物在阳光强烈时睡眠）
        // 1-2级: 3能量
        // 3-6级: 4能量
        // 7+级: 6能量
        energy = (entity.level >= this.LevelThresholds1)
          ? (entity.level >= this.LevelThresholds2 ? 6 : 4)
          : 3;
      } else {
        // 清醒（夜间）时产能更多
        // 1-6级: 5能量
        // 7+级: 8能量
        energy = (entity.level >= this.LevelThresholds2) ? 8 : 5;
      }
      energyToAdd += energy;
    }

    // 通过 ResourceManager 更新全体能量
    if (energyToAdd > 0) {
      ResourceManager.Instance.UpdateEnergy(energyToAdd, 'all');
      this.scheduleVisualFlash(entity, 300);
      entity.playGenerateAnimation();
    }
  }

  onStarShards(entity: GeneratorEntity): void {
    if (entity.currentHealth <= 0) return;

    // 唤醒自己和周围3x3范围内的所有队友
    for (let i = entity.col - 1; i <= entity.col + 1; i++) {
      for (let j = entity.row - 1; j <= entity.row + 1; j++) {
        // 检查坐标是否合法
        const gridWidth = PositionManager.Instance.Col_Number || 10;
        const gridHeight = PositionManager.Instance.Row_Number || 5;

        if (i >= 0 && i < gridWidth && j >= 0 && j < gridHeight) {
          const key = `${i}-${j}`;
          const plantList = PlantsManager.Instance.PlantsMap.get(key);
          if (plantList) {
            for (const plant of plantList) {
              // ✅ 使用 PlantCmd.SetSleeping 确保状态变化被正确延迟处理
              PlantCmd.SetSleeping(plant, false);
            }
          }
        }
      }
    }

    // 恢复自己的血量
    PlantCmd.SetHealth(entity, entity.maxHealth);
    this.scheduleVisualFlash(entity, 300);
    entity.playAwakAnimation();
  }

  public createEntity(scene: Game, col: number, row: number, level: number) {
    return this.initializeEntity(new GeneratorEntity(scene, col, row, level));
  }
}

export class GeneratorEntity extends PlantEntity {
  declare public damagedSum: number;
  declare public visualFrameUntilFrame: number;
  declare public visualFrameValue: number;

  constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, GeneratorData, level);
    this.damagedSum = 0;
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
    this.syncViewFromModel();
  }

  public playAwakAnimation() {
    this.syncViewFromModel();
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite | undefined;
    if (!sprite?.frame) return;
    const frame = this.currentHealth > 0 && this.visualFrameUntilFrame > 0 ? this.visualFrameValue : 0;
    if (sprite.frame.name !== String(frame)) sprite.setFrame(frame);
  }
}

export const GeneratorData = new GeneratorModel();
