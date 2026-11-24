import type { Game } from "../../../../scenes/Game";
import type { MonsterDefinition } from "../../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../../models/entities/MonsterEntity";
import { StickZombieEntity, StickZombieModel } from "../stick_zombie";
import { createZombieAnimController } from "../../../../models/monster/anims/LegacyMonsterAnimControllers";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../../constants/game";
import { PositionManager } from "../../../../managers/view/PositionManager";
import DepthHelper from "../../../../utils/helper/DepthHelper";

/**
 * 海豚骑乘僵尸：骑手是普通僵尸，坐骑是 250 血海豚，采用"优先打坐骑"。
 * 坐骑血量、破碎与伤害路由都在 MediumMonsterModel。
 *
 * 撑杆跳是手杖僵尸的水中版本：复用 StickZombieModel/Entity 的判定线与普攻入口拦截，
 * 只把"一次性消耗品"从手杖换成海豚坐骑——只有 hasMount() 时才能起跳一次，
 * 落地 consumeVault 调 breakMount 让海豚死亡，此后骑手不再起跳。
 * 骑手本体免疫溺水（canDrown:false），海豚破碎后也不会在水里掉血。
 */
export class DolphinRiderModel extends StickZombieModel {
  public constructor(def: MonsterDefinition) {
    super(def);
    // 骑手没有手杖；一次性跳跃能力由海豚坐骑承载。
    this.hasStick = false;
  }

  /** 只有海豚坐骑还在架时才能起跳；判定线 / 碰撞入口共用此门控。 */
  protected override get canVault(): boolean {
    return this.hasMount() && !this.flying && !this.isDying && !this.isFrozen;
  }

  /** 落地即让海豚坐骑死亡（之后 hasMount() 为 false，无法二次起跳）。 */
  protected override consumeVault(entity: MonsterEntity): void {
    this.breakMount(entity);
  }

  public override onMountBroken(_entity: MonsterEntity): void {
    this.speed = MonsterSpeed.Zombie;
  }
}

export class DolphinRiderEntity extends StickZombieEntity {
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
  // 作为手杖僵尸的 water 变种生成，不进普通出怪池。
  weight: () => 0,
  leastWaveID: 8,
  habitats: ["water"],
  // 骑手本体免疫溺水：海豚破碎后落水也不掉血。
  canDrown: false,
  mountHealth: 250,
  mountDamagePriority: "mount",
  maxHealth: 300,
  baseSpeed: MonsterSpeed.StickZombie,
  baseAttackDamage: 20,
  attackInterval: ZombieAttackInterval.Zombie,
  damageThresholds: [150],
  createEntity: (scene, col, row, model, waveID) =>
    new DolphinRiderEntity(scene, col, row, model as DolphinRiderModel, waveID),
});
