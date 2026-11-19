import { LevelScaledValue } from "../../../../utils/numbervalue";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import type { JsonValue } from "../../../core/SimulationState";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { GainEnergySfx, GainEnergySfxSize } from "../../../sfx/energy/GainEnergySfx";
import ResourceCmd from "../../../utils/cmd/ResourceCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";

const FURNACE_EVENTS = {
  FurnaceGenerate: "FurnaceGenerate",
} as const;

export class FurnaceModel extends PlantModel {
  public visualFrameUntilFrame = 0;
  public visualFrameValue = 0;

  public override pid = 2;
  public override nameKey = 'name_furnace';
  public override descriptionKey = 'furnace_description';
  public override texturePath = 'plant/furnace';

  public override readonly tickEventNames: readonly string[] = [
    ...DEFAULT_TICK_EVENT_NAMES,
    FURNACE_EVENTS.FurnaceGenerate,
  ];

  public maxHealth = new LevelScaledValue(300);
  public cost = new LevelScaledValue(50).setThreshold(5, 35);
  public cooldown = new LevelScaledValue(6000);
  public cooldownStartAtRatio = 0;

  generateEnergyCooldown = new LevelScaledValue(25000).setDecValue(0.85); // 生成能量的冷却时间，随等级增加而递减
  generateEnergyAmount = new LevelScaledValue(25).setThreshold(9, 40); // 生成能量的数量，9级时提升
  public damage = new LevelScaledValue(0); // 炉子没有伤害

  isNightPlant = false;

  /** 视觉生成态：进 Model 快照，回滚后由实体同步 sprite frame。 */
  public generating = false;

  onCreate(entity: FurnaceEntity): void {
    // 启动能量生产定时器
    const cooldownTime = this.generateEnergyCooldown.getValueAt(entity.level);
    this.tickmanager.schedule(FURNACE_EVENTS.FurnaceGenerate, cooldownTime, {
      startAt: cooldownTime * 0.7,
      loop: true,
    });
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === FURNACE_EVENTS.FurnaceGenerate) {
      const eventArgs = args && typeof args === "object" && !Array.isArray(args)
        ? args as Record<string, JsonValue>
        : {};
      if (eventArgs.reset === true) {
        this.generating = false;
        (this.host as FurnaceEntity | null)?.syncViewFromModel();
        return;
      }
      this.onGenerate(this.host as FurnaceEntity | null);
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private onGenerate(entity: FurnaceEntity | null): void {
    if (!entity) return;
    if (this.isSleeping || entity.currentHealth <= 0 || !entity.scene?.time) return;

    this.generating = true;
    entity.syncViewFromModel();
    this.playGainEnergySfx(entity, "medium", true);
    const energyToAdd = this.generateEnergyAmount.getValueAt(entity.level);
    ResourceCmd.AddEnergyToAll(energyToAdd);
    this.tickmanager.schedule(FURNACE_EVENTS.FurnaceGenerate, 1000, {
      args: { reset: true },
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
  declare public visualFrameUntilFrame: number;
  declare public visualFrameValue: number;

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

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    if (!this.viewGroup?.children) return;
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite | undefined;
    if (!sprite?.frame) return;

    const model = this.model as FurnaceModel;
    const active = model.generating && this.currentHealth > 0;
    const frame = active && model.visualFrameUntilFrame > 0 ? model.visualFrameValue : (active ? 1 : 0);
    if (sprite.frame.name !== String(frame)) sprite.setFrame(frame);
  }
}

export const FurnaceData = new FurnaceModel();
