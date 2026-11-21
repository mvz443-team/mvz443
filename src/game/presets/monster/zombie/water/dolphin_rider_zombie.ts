import type { Game } from "../../../../scenes/Game";
import type { BaseEntity } from "../../../../models/core/BaseEntity";
import type { MonsterEntity } from "../../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../../models/entities/MonsterEntity";
import { BaseZombieEntity } from "../zombie";
import { createZombieAnimController } from "../../../../models/monster/anims/LegacyMonsterAnimControllers";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import { PositionManager } from "../../../../managers/view/PositionManager";
import DepthHelper from "../../../../utils/helper/DepthHelper";

export type MountDamagePriority = "rider" | "mount";

const MOUNT_SPRITE_KEYS = ["dolphin_body", "dolphin_tail", "dolphin_fin"] as const;

/**
 * 海豚骑乘僵尸：单实体内的"坐骑层 + 骑乘者层"双层结构。
 *
 * - 坐骑（海豚）有独立血条（20）；骑乘者是普通僵尸。
 * - `mountDamagePriority` 决定一次伤害先打谁；两种优先级下骑乘者死亡都整体死亡，
 *   坐骑死亡而骑乘者还在时切换回普通僵尸视图与行走速度。
 * - 坐骑在架时移动速度取撑杆跳僵尸，坐下时两腿固定顺时针 20°。
 * - 所有会改变模拟结果的字段（坐骑血/破碎/优先级）都在 Model，自动进快照。
 */
export class DolphinRiderModel extends PresetMonsterModel {
  public mountHealth: number = 0;
  public mountHealthMax: number = 0;
  public mountBroken: boolean = false;
  public mountDamagePriority: MountDamagePriority = "mount";

  /** 海豚血量固定 20；属于模型数值。 */
  public readonly mountHealthConfig: number = 20;

  public override initializeState(scene: Game, col: number, row: number, waveID: number): void {
    super.initializeState(scene, col, row, waveID);
    this.mountHealthMax = this.mountHealthConfig;
    this.mountHealth = this.mountHealthConfig;
    this.mountBroken = false;
  }

  public hasMount(): boolean {
    return !this.mountBroken && this.mountHealth > 0;
  }

  /** 优先打坐骑时由坐骑吸收本次伤害；返回 true 表示本体不再结算。 */
  public absorbMountDamage(amount: number, _source?: BaseEntity): boolean {
    if (!this.hasMount() || this.mountDamagePriority === "rider") return false;
    this.mountHealth = Math.max(0, this.mountHealth - amount);
    if (this.mountHealth === 0) this.breakMount();
    return true;
  }

  /** 坐骑破碎：切换回骑乘者本体的普通僵尸速度与视图。 */
  public breakMount(): void {
    if (this.mountBroken) return;
    this.mountHealth = 0;
    this.mountBroken = true;
    this.speed = MonsterSpeed.Zombie;
  }

  public override takeDamage(entity: MonsterEntity, amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    super.takeDamage(entity, amount, dealer, source);
    // 骑乘者死亡 → 整体死亡：坐骑层一并清空，避免回滚后残留"无主海豚"。
    if (this.health <= 0 && this.hasMount()) {
      this.mountHealth = 0;
      this.mountBroken = true;
    }
  }
}

export class DolphinRiderEntity extends BaseZombieEntity {
  declare public model: DolphinRiderModel;

  public constructor(scene: Game, col: number, row: number, model: DolphinRiderModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected override createAnimController() {
    return createZombieAnimController("zombie", this.scene, this.x, this.y);
  }

  protected override buildView(): void {
    super.buildView();
    if (this.attachSprites.has("dolphin_body")) return;

    const baseScale = PositionManager.Instance.scaleFactor;
    const gridX = PositionManager.Instance.GRID_SIZEX;
    const gridY = PositionManager.Instance.GRID_SIZEY;
    // 与 MonsterEntity.checkAndAddBoat 完全一致：同样锚点、缩放与前后深度。
    const boatY = this.y + 15 * baseScale;
    const backDepth = DepthHelper.Mob.boatBack(this.baseDepth);
    const frontDepth = DepthHelper.Mob.boatFront(this.baseDepth);

    const parts: Array<[string, number, number, number]> = [
      ["dolphin_tail", this.x + gridX * 0.42, boatY, backDepth],
      ["dolphin_body", this.x, boatY, frontDepth],
      ["dolphin_fin", this.x - gridX * 0.12, boatY - gridY * 0.22, frontDepth],
    ];
    for (const [key, x, y, depth] of parts) {
      const sprite = this.scene.add.sprite(x, y, `attach/${key}`)
        .setOrigin(0.5, 1)
        .setScale(baseScale * 1.4)
        .setDepth(depth);
      this.attachSprites.set(key, sprite);
      this.viewGroup.add(sprite);
      this.registerEquipmentAttachment(key);
    }
  }

  public override syncViewFromModel(): void {
    super.syncViewFromModel();
    const mounted = this.model.hasMount();
    this.animController.setRidingPose?.(mounted);
    for (const key of MOUNT_SPRITE_KEYS) {
      this.attachSprites.get(key)?.setVisible(mounted);
    }
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (this.model.absorbMountDamage(amount, source)) {
      this.syncViewFromModel();
      return;
    }
    super.takeDamage(amount, dealer, source);
  }
}

export const DolphinRiderZombieData = new DolphinRiderModel({
  mid: 28,
  nameKey: "DolphinRiderZombie",
  level: 3,
  weight: (waveID) => Math.max(300, 1400 - (waveID - 10) * 80),
  leastWaveID: 8,
  habitats: ["water"],
  maxHealth: 300,
  baseSpeed: MonsterSpeed.StickZombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Zombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) =>
    new DolphinRiderEntity(scene, col, row, model as DolphinRiderModel, waveID),
});
