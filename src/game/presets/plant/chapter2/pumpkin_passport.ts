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
 * - 血量降到 `brokenHealthRatio` 以下时外壳显示破损（裂缝 + 崩口）。
 * - 渲染分两层：后壁在内部植物之后，前壁在内部植物之前。
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
  /** 血量低于该比例时外壳进入破损外观；纯表现阈值，定义在 Model。 */
  public readonly brokenHealthRatio: number = 0.5;

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

/**
 * 外壳贴图帧（64x64 spritesheet，见 public/assets/plant/pumpkin_passport.png）。
 *
 * 帧 0/1 是完整外壳（普通 / 尖刺），留给种植预览与部署虚影这类"还没叠植物"的场景；
 * 后壁与前壁按「普通 / 破损 / 尖刺 / 尖刺+破损」成对出现，
 * 由 Entity 只读 Model 状态（isSpiky + 血量比例）后选择。
 */
const PUMPKIN_FRAMES = {
  back: { normal: 2, broken: 4, spiky: 6, spikyBroken: 8 },
  front: { normal: 3, broken: 5, spiky: 7, spikyBroken: 9 },
} as const;

export class PumpkinPassportEntity extends PlantEntity {
  /** 尖刺状态定义在 Model，Entity 通过访问器读取。 */
  declare public isSpiky: boolean;

  private backSprite: Phaser.GameObjects.Sprite | null = null;
  private frontSprite: Phaser.GameObjects.Sprite | null = null;

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

    // 后壁：画在同格内部植物之后，让植物的上半部分盖住壳的后沿。
    this.backSprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, PUMPKIN_FRAMES.back.normal)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(DepthHelper.Plant.shieldShellBack(this.baseDepth));

    // 前壁：画在内部植物之前，罩住植物下半部分并露出护照。
    this.frontSprite = this.scene.add.sprite(this.x, this.y, this.model.texturePath, PUMPKIN_FRAMES.front.normal)
      .setOrigin(0.5, 1)
      .setDisplaySize(size.sizeX, size.sizeY)
      .setDepth(DepthHelper.Plant.shieldShell(this.baseDepth));

    this.viewGroup.addMultiple([this.backSprite, this.frontSprite]);
  }

  /** 受击后血量可能跨过破损阈值；表现单向下行，不改任何业务状态。 */
  public override onHurt(
    amount: number,
    realDamage: number,
    dealer?: BaseEntity,
    source?: BaseEntity,
  ): void {
    super.onHurt(amount, realDamage, dealer, source);
    this.syncSpikyView();
  }

  /** 帧完全由 Model 决定：尖刺状态 + 血量是否低于破损阈值。 */
  public syncSpikyView(): void {
    const model = this.model as PumpkinPassportModel;
    const spiky = model.isSpiky;
    const broken = this.isShellBroken();

    const backFrame = this.pickFrame(PUMPKIN_FRAMES.back, spiky, broken);
    const frontFrame = this.pickFrame(PUMPKIN_FRAMES.front, spiky, broken);

    this.backSprite?.setFrame(backFrame);
    this.frontSprite?.setFrame(frontFrame);
  }

  private pickFrame(
    frames: { normal: number, broken: number, spiky: number, spikyBroken: number },
    spiky: boolean,
    broken: boolean,
  ): number {
    if (spiky) return broken ? frames.spikyBroken : frames.spiky;
    return broken ? frames.broken : frames.normal;
  }

  private isShellBroken(): boolean {
    const model = this.model as PumpkinPassportModel;
    const ratio = model.brokenHealthRatio;
    // 血量上限读 Model 的运行时字段：Entity 上的 maxHealth 可能被同名配置遮蔽。
    const max = model.healthMax;
    if (!(max > 0)) return false;
    return this.currentHealth <= max * ratio;
  }

  public playSpikeActivateAnimation(): void {
    const sprite = this.frontSprite ?? this.backSprite;
    if (!sprite) return;
    SfxCmd.Create(ShieldActivateSfx, {
      scene: this.scene,
      sprite,
    });
  }
}

export const PumpkinPassportData = new PumpkinPassportModel();
