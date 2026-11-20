import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import { BaseEntity } from "../../../models/core/BaseEntity";
import { CombatEntity } from "../../../models/core/CombatEntity";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { ShieldActivateSfx } from "../../../sfx/flash/ShieldActivateSfx";
import DepthHelper from "../../../utils/helper/DepthHelper";

/**
 * 南瓜护照 - 低矮护盾植物。
 *
 * - `tiny = true`：低矮，地面子弹打不到它。
 * - 护盾植物（`SHIELD_PLANT_PIDS`）：同格内部植物受击时先由它承受伤害。
 * - 2500 血、125 能量；本身不攻击。
 *
 * 星之碎片：回满血量并进入尖刺状态；已经尖刺时只回血。
 * 尖刺状态下每次受到近战伤害（有 dealer、无投射物来源）返还一半伤害给伤害源。
 */
export class PumpkinPassportModel extends PlantModel {
  public override pid = 19;
  public override nameKey = 'name_pumpkin_passport';
  public override descriptionKey = 'pumpkin_passport_description';
  public override texturePath = 'plant/pumpkin_passport';

  public maxHealth = new LevelScaledValue(2500);
  public cost = new LevelScaledValue(125);
  public cooldown = new LevelScaledValue(25000);
  public cooldownStartAtRatio = 1;
  public damage = new LevelScaledValue(0);
  public isNightPlant = false;

  /** 尖刺状态：只有星之碎片能打开，进入后不可关闭。 */
  public isSpiky: boolean = false;
  /** 近战反伤比例；数值定义在 Model，Entity 不参与。 */
  public readonly spikeReflectRatio: number = 0.5;

  public constructor() {
    super();
    // 低矮植物：只有带 tiny 的投射物能命中。
    this.tiny = true;
  }

  public override onStarShards(entity: PumpkinPassportEntity): void {
    if (entity.currentHealth <= 0) return;

    PlantCmd.SetHealth(entity, entity.maxHealth);
    if (this.isSpiky) {
      // 已经尖刺：只回血，不重复触发。
      entity.syncSpikyView();
      return;
    }

    this.isSpiky = true;
    entity.playSpikeActivateAnimation();
    entity.syncSpikyView();
  }

  public override onHurt(
    entity: PumpkinPassportEntity,
    _damage: number,
    realDamage: number,
    dealer?: BaseEntity,
    source?: BaseEntity,
  ): void {
    if (!this.isSpiky) return;
    if (realDamage <= 0) return;
    // 只反还近战直伤：带投射物来源（子弹/激光/爆炸）的伤害不返还。
    if (source) return;
    if (!(dealer instanceof CombatEntity)) return;
    if (dealer === entity) return;

    const reflect = Math.floor(realDamage * this.spikeReflectRatio);
    if (reflect <= 0) return;
    dealer.takeDamage(reflect, entity);
  }

  public createEntity(scene: Game, col: number, row: number, level: number): PumpkinPassportEntity {
    return this.initializeEntity(new PumpkinPassportEntity(scene, col, row, level));
  }
}

export class PumpkinPassportEntity extends PlantEntity {
  /** 尖刺状态定义在 Model，Entity 通过访问器读取。 */
  declare public isSpiky: boolean;

  public constructor(scene: Game, col: number, row: number, level: number) {
    super(scene, col, row, PumpkinPassportData, level);
    this.syncSpikyView();
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    this.syncSpikyView();
  }

  protected buildView(): void {
    const size = PositionManager.Instance.getPlantDisplaySize();

    const sprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(DepthHelper.Plant.shieldShell(this.baseDepth));

    this.viewGroup.add(sprite);
  }

  /** 帧 0 = 普通外壳，帧 1 = 尖刺状态。 */
  public syncSpikyView(): void {
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite | undefined;
    if (!sprite) return;
    sprite.setFrame((this.model as PumpkinPassportModel).isSpiky ? 1 : 0);
  }

  public playSpikeActivateAnimation(): void {
    const sprite = this.viewGroup.getChildren()[0] as Phaser.GameObjects.Sprite | undefined;
    if (!sprite) return;
    SfxCmd.Create(ShieldActivateSfx, {
      scene: this.scene,
      sprite,
    });
  }
}

export const PumpkinPassportData = new PumpkinPassportModel();
