import type { Game } from "../../../../scenes/Game";
import type { BaseEntity } from "../../../../models/core/BaseEntity";
import { PresetMonsterModel, BaseMonsterEntity, type MonsterEntity } from "../../../../models/entities/MonsterEntity";
import { BaseZombieEntity } from "../zombie";
import { createZombieAnimController } from "../../../../models/monster/anims/LegacyMonsterAnimControllers";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import { PositionManager } from "../../../../managers/view/PositionManager";
import DepthHelper from "../../../../utils/helper/DepthHelper";

/**
 * 潜水僵尸：普通僵尸套上潜水镜与呼吸管两个独立图层，血量/速度与原版一致。
 * 非攻击时 tiny=true（半潜在水里），只有带 tiny 触及能力的投射物能命中；
 * 进入攻击时抬起身体 tiny=false，此后普通投射物也能命中。
 */
export class DivingZombieModel extends PresetMonsterModel {
  public override onCreate(_entity: MonsterEntity): void {
    this.tiny = true;
  }

  public override tryStartAttack(entity: MonsterEntity, target: BaseEntity): boolean {
    const started = super.tryStartAttack(entity, target);
    if (started) this.tiny = false;
    return started;
  }

  public override stopAttacking(entity: MonsterEntity): void {
    super.stopAttacking(entity);
    this.tiny = true;
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

    const scale = PositionManager.Instance.scaleFactor;
    const depth = DepthHelper.Mob.customAttachment(this.baseDepth, 14);
    const goggles = this.scene.add.sprite(
      this.x + this.offsetX,
      this.y + this.offsetY - PositionManager.Instance.GRID_SIZEY * 0.52,
      "attach/diving_goggles",
    ).setScale(scale).setDepth(depth);
    const snorkel = this.scene.add.sprite(
      this.x + this.offsetX + PositionManager.Instance.GRID_SIZEX * 0.16,
      this.y + this.offsetY - PositionManager.Instance.GRID_SIZEY * 0.64,
      "attach/diving_snorkel",
    ).setScale(scale).setDepth(depth);

    this.attachSprites.set("diving_goggles", goggles);
    this.attachSprites.set("diving_snorkel", snorkel);
    this.viewGroup.addMultiple([goggles, snorkel]);
    this.registerEquipmentAttachment("diving_goggles");
    this.registerEquipmentAttachment("diving_snorkel");
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
