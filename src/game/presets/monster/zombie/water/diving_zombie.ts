import type { Game } from "../../../../scenes/Game";
import type { BaseEntity } from "../../../../models/core/BaseEntity";
import { PresetMonsterModel, type MonsterEntity } from "../../../../models/entities/MonsterEntity";
import { BaseZombieEntity } from "../zombie";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import { PositionManager } from "../../../../managers/view/PositionManager";
import DepthHelper from "../../../../utils/helper/DepthHelper";

/**
 * 潜水僵尸：普通僵尸套上潜水镜与呼吸管两个独立图层，血量/速度与原版一致。
 *
 * - 常态：tiny=true，只显示头部 + 氧气面罩（面罩每帧绑定头部挂点），身体淡出。
 * - 攻击开始：逻辑上立即 tiny=false，随后播放"探出身来"淡入；换目标期间保持 tiny=false，不潜水。
 * - 攻击停止：逻辑上立即 tiny=true，随后播放"潜下去"淡出；同格多植物接力时不会中途潜水。
 *
 * tiny 在 Model 里切换并自动进快照；视图只经 syncViewFromModel() 单向同步。
 */
export class DivingZombieModel extends PresetMonsterModel {
  /** 仅在 tryStartAttack 的同步调用栈内为真：优先级换目标会先 stopAttacking，此处抑制潜水。 */
  public suppressingDive = false;

  public override onCreate(entity: MonsterEntity): void {
    this.tiny = true;
    entity.syncViewFromModel();
  }

  public override tryStartAttack(entity: MonsterEntity, target: BaseEntity): boolean {
    this.suppressingDive = true;
    const started = super.tryStartAttack(entity, target);
    this.suppressingDive = false;
    if (started) this.setSurfaced(entity);
    return started;
  }

  public override stopAttacking(entity: MonsterEntity): void {
    super.stopAttacking(entity);
    // retargetAttack 不走这里；优先级换目标由 suppressingDive 抑制，只有真正停攻才潜水。
    if (!this.suppressingDive) this.setDived(entity);
  }

  private setSurfaced(entity: MonsterEntity): void {
    if (this.tiny === false) return;
    this.tiny = false;
    entity.syncViewFromModel();
  }

  private setDived(entity: MonsterEntity): void {
    if (this.tiny === true) return;
    this.tiny = true;
    entity.syncViewFromModel();
  }
}

export class DivingZombieEntity extends BaseZombieEntity {
  declare public model: DivingZombieModel;

  public constructor(scene: Game, col: number, row: number, model: DivingZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected override buildView(): void {
    super.buildView();
    if (this.attachSprites.has("diving_goggles")) return;

    const scale = PositionManager.Instance.scaleFactor * 0.7;
    const depth = DepthHelper.Mob.customAttachment(this.baseDepth, 14);
    const goggles = this.scene.add.sprite(this.x, this.y, "attach/diving_goggles")
      .setScale(scale).setDepth(depth);
    const snorkel = this.scene.add.sprite(this.x, this.y, "attach/diving_snorkel")
      .setScale(scale).setDepth(depth);

    this.attachSprites.set("diving_goggles", goggles);
    this.attachSprites.set("diving_snorkel", snorkel);
    this.viewGroup.addMultiple([goggles, snorkel]);
  }

  /** 面罩相对头部挂点固定，每帧跟随（身体部件位置由动画控制器改写，不能用实体坐标）。 */
  private syncMaskToHead(): void {
    const head = this.animController.getHeadAnchor?.();
    if (!head) return;
    const gridX = PositionManager.Instance.GRID_SIZEX;
    const gridY = PositionManager.Instance.GRID_SIZEY;
    this.attachSprites.get("diving_goggles")?.setPosition(head.x, head.y + gridY * 0.10);
    this.attachSprites.get("diving_snorkel")?.setPosition(head.x + gridX * 0.13, head.y - gridY * 0.04);
  }

  public override updateView(vec: { x: number, y: number }): void {
    super.updateView(vec);
    this.syncMaskToHead();
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    this.animController.setDivingPose?.(this.model.tiny);
    this.syncMaskToHead();
  }
}

export const DivingZombieData = new DivingZombieModel({
  mid: 27,
  nameKey: "DivingZombie",
  level: 2,
  weight: (waveID) => Math.max(400, 1800 - (waveID - 8) * 100),
  leastWaveID: 6,
  habitats: ["water"],
  maxHealth: 300,
  baseSpeed: MonsterSpeed.Zombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Zombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) =>
    new DivingZombieEntity(scene, col, row, model as DivingZombieModel, waveID),
});
