import type { Game } from "../../../../scenes/Game";
import type { BaseEntity } from "../../../../models/core/BaseEntity";
import type { MonsterEntity } from "../../../../models/entities/MonsterEntity";
import { BaseZombieEntity, ZombieModel } from "../zombie";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import { PositionManager } from "../../../../managers/view/PositionManager";
import DepthHelper from "../../../../utils/helper/DepthHelper";
import type { EquipmentDef } from "../../../../models/equipment/Equipment";

/** 潜水波纹的两个独立图层，错相播放形成游动感。 */
const RIPPLE_KEYS = ["diving_ripple_a", "diving_ripple_b"] as const;

/** 氧气面罩：100 血，吸收 10% 伤害；视觉由 Entity 的两层自定义挂点负责。 */
const DIVING_MASK: EquipmentDef = {
  key: "attach/diving_goggles",
  maxHealth: 100,
  thresholds: [],
  absorbRatio: 0.1,
  viewless: true,
};

/**
 * 潜水僵尸：普通僵尸套上潜水镜与呼吸管两个独立图层，血量/速度与原版一致。
 *
 * - 常态：tiny=true，只显示头部 + 氧气面罩（面罩每帧绑定头部挂点），身体淡出。
 * - 攻击开始：逻辑上立即 tiny=false，随后播放"探出身来"淡入；换目标期间保持 tiny=false，不潜水。
 * - 攻击停止：逻辑上立即 tiny=true，随后播放"潜下去"淡出；同格多植物接力时不会中途潜水。
 *
 * tiny 在 Model 里切换并自动进快照；视图只经 syncViewFromModel() 单向同步。
 */
export class DivingZombieModel extends ZombieModel {
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
  private rippleTweens: Phaser.Tweens.Tween[] = [];
  private ripplePlaying = false;

  public constructor(scene: Game, col: number, row: number, model: DivingZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected override buildView(): void {
    super.buildView();
    if (this.attachSprites.has("diving_goggles")) return;

    // 面罩/呼吸管不是固定装备挂点：它们必须跟着头部走。潜水时头部在格子底部中央，
    // 起身时头部回到身体上方，两种姿态都靠 getHeadAnchor() 取同一个头部挂点。
    const scale = PositionManager.Instance.scaleFactor;
    const depth = DepthHelper.Mob.customAttachment(this.baseDepth, 13);
    const goggles = this.scene.add.sprite(this.x, this.y, "attach/diving_goggles")
      .setScale(scale).setOrigin(0.5, 0.5).setDepth(depth);
    const snorkel = this.scene.add.sprite(this.x, this.y, "attach/diving_snorkel")
      .setScale(scale).setOrigin(0.5, 0.5).setDepth(depth);

    this.attachSprites.set("diving_goggles", goggles);
    this.attachSprites.set("diving_snorkel", snorkel);
    this.viewGroup.addMultiple([goggles, snorkel]);

    // 波纹在头部下方，深度比面罩低一层；初始隐藏，由 syncViewFromModel 按 tiny 启停。
    for (const key of RIPPLE_KEYS) {
      const sprite = this.scene.add.sprite(this.x, this.y, `attach/${key}`)
        .setScale(scale).setOrigin(0.5, 0.5).setDepth(depth - 1)
        .setVisible(false).setAlpha(0);
      this.attachSprites.set(key, sprite);
      this.viewGroup.add(sprite);
    }
    this.syncDivingAttachments();
  }

  public override updateView(vec: { x: number; y: number }): void {
    super.updateView(vec);
    // 头部每帧被 animController 重新定位，面罩随之同步。
    this.syncDivingAttachments();
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    this.animController.setDivingPose?.(this.model.tiny);
    // setDivingPose 立即改变头部挂点；同步面罩与波纹，避免下一帧 updateView 前错位。
    this.syncDivingAttachments();
    this.setRippleVisible(this.model.tiny);
  }

  /** 把面罩与呼吸管绑定到当前头部挂点（潜水/起身同一套逻辑）。 */
  private syncDivingAttachments(): void {
    const head = this.animController.getHeadAnchor?.();
    if (!head) return;
    const goggles = this.attachSprites.get("diving_goggles");
    const snorkel = this.attachSprites.get("diving_snorkel");
    if (!goggles || !snorkel) return;
    const gridX = PositionManager.Instance.GRID_SIZEX;
    const gridY = PositionManager.Instance.GRID_SIZEY;
    goggles.setPosition(head.x, head.y);
    snorkel.setPosition(head.x + gridX * 0.2, head.y - gridX * 0.06);
    const mask = this.model.equipment.head;
    const maskAlive = !mask || (!mask.broken && mask.health > 0);
    goggles.setVisible(maskAlive);
    snorkel.setVisible(maskAlive);
    // 波纹跟随头部下方；Tween 只改 alpha/scaleX，不与每帧位置同步冲突。
    for (const key of RIPPLE_KEYS) {
      this.attachSprites.get(key)?.setPosition(head.x, head.y + gridY * 0.24);
    }
  }

  /** 潜水态播放两层错相波纹；起身时立即停掉并隐藏（纯表现，不进快照）。 */
  private setRippleVisible(visible: boolean): void {
    if (this.ripplePlaying === visible) return;
    this.ripplePlaying = visible;
    this.rippleTweens.forEach((tween) => tween.stop());
    this.rippleTweens = [];

    const scale = PositionManager.Instance.scaleFactor;
    RIPPLE_KEYS.forEach((key, index) => {
      const sprite = this.attachSprites.get(key);
      if (!sprite) return;
      sprite.setVisible(visible);
      sprite.setScale(scale);
      sprite.setAlpha(visible ? 0 : 1);
      if (!visible) return;
      this.rippleTweens.push(this.scene.tweens.add({
        targets: sprite,
        alpha: { from: 0, to: 0.9 },
        scaleX: { from: 0.85, to: 1.15 },
        duration: 900,
        delay: index * 450,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }));
    });
  }
}

export const DivingZombieData = new DivingZombieModel({
  mid: 27,
  nameKey: "DivingZombie",
  level: 2,
  weight: (waveID) => Math.max(400, 1800 - (waveID - 8) * 100),
  leastWaveID: 6,
  habitats: ["water"],
  canDrown: false,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.Zombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Zombie,
  damageThresholds: [150],
  equipment: { head: DIVING_MASK },
  createEntity: (scene, col, row, model, waveID) =>
    new DivingZombieEntity(scene, col, row, model as DivingZombieModel, waveID),
});
