import type { Game } from "../../../../scenes/Game";
import type { BaseEntity } from "../../../../models/core/BaseEntity";
import type { MonsterEntity } from "../../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../../models/entities/MonsterEntity";
import { BaseZombieEntity } from "../zombie";
import { createZombieAnimController } from "../../../../models/monster/anims/LegacyMonsterAnimControllers";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import { PositionManager } from "../../../../managers/view/PositionManager";
import DepthHelper from "../../../../utils/helper/DepthHelper";

/**
 * 海豚骑乘僵尸：骑手是普通僵尸，坐骑是 250 血海豚，采用"优先打坐骑"。
 * 坐骑的血量、破碎与伤害路由都在通用 MonsterModel；这里只保留海豚图层与速度回退。
 */
export class DolphinRiderModel extends PresetMonsterModel {
  public override onMountBroken(_entity: MonsterEntity): void {
    this.speed = MonsterSpeed.Zombie;
  }

  public override takeDamage(entity: MonsterEntity, amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    super.takeDamage(entity, amount, dealer, source);
    // 骑乘者死亡 → 整体死亡：坐骑层一并清空，避免回滚后残留"无主海豚"。
    if (this.health <= 0 && this.hasMount()) this.breakMount(entity);
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
}

export const DolphinRiderZombieData = new DolphinRiderModel({
  mid: 28,
  nameKey: "DolphinRiderZombie",
  level: 3,
  weight: (waveID) => Math.max(300, 1400 - (waveID - 10) * 80),
  leastWaveID: 8,
  habitats: ["water"],
  mountHealth: 250,
  mountDamagePriority: "mount",
  maxHealth: 300,
  baseSpeed: MonsterSpeed.StickZombie,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Zombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) =>
    new DolphinRiderEntity(scene, col, row, model as DolphinRiderModel, waveID),
});
