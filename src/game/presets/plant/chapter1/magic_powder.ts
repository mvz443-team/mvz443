import DepthHelper from "../../../utils/helper/DepthHelper";
import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantModel } from "../../../models/PlantModel";
import { Faction } from "../../../models/Enum";
import type { Game } from "../../../scenes/Game";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { PowderScatterSfx } from "../../../sfx/powder/PowderScatterSfx";
import SoundCmd from "../../../utils/cmd/SoundCmd";
import ResourceCmd from "../../../utils/cmd/ResourceCmd";

/**
 * 魔法粉 - 一次性瞬间植物。
 *
 * 种植落地的同一确定性帧内直接发射激光、产出星碎并播放特效，
 * 不创建 Entity / 物理体，也没有存活定时器。
 */
export class MagicPowderModel extends PlantModel {
  public override pid = 10;
  public override nameKey = 'name_magic_powder';
  public override descriptionKey = 'magic_powder_brief';
  public override texturePath = 'plant/magic_powder';

  public maxHealth = new LevelScaledValue(9999); // 秒杀值，几乎无敌
  public cost = new LevelScaledValue(175).setThreshold(5, 150);
  public cooldown = new LevelScaledValue(55000).setThreshold(9, 48000); // 55秒 / 9级时48秒
  public cooldownStartAtRatio = 1; // 需要完整等待cooldown

  // 激光伤害：1-8级 1500，9级时提升到更高
  public damage = new LevelScaledValue(1500).setThreshold(9, 2000);

  isNightPlant = false;

  /** 魔术粉沿用原有规则：忽略同格占用，但仍受地块规则限制。 */
  public override placementRule = 'overlayAny' as const;
  /** 种植即结算，不存在存活实体。 */
  public override isOneTimePlant = true;

  public override applyInstantEffect(
    scene: Game,
    col: number,
    row: number,
    level: number,
    faction: Faction = Faction.PLANT,
  ): void {
    const { x, y } = PositionManager.Instance.getPlantBottomCenter(col, row);
    const damageValue = this.damage.getValueAt(level);
    const rangeWidth = PositionManager.Instance.GRID_SIZEX;

    SoundCmd.PlayPlant('magic');
    SfxCmd.Create(PowderScatterSfx, {
      scene,
      x,
      y,
      depth: DepthHelper.Plant.sfx(DepthHelper.Plant.base(row)),
      color: 0x2ba8ff,
      count: 30,
      rangeWidth: rangeWidth * 1.35,
      rangeHeight: PositionManager.Instance.GRID_SIZEY * 1.2,
      duration: 900,
    });

    // 星碎掉落：特效立即播（起点为当前格子底部中心），到账由可恢复全局计时器延迟。
    ResourceCmd.AddStarshardToAllWithAnim(1, {
      origin: { x, y },
      amount: 1,
    });

    ProjectileCmd.CreateLaser(
      scene,
      x - rangeWidth * 0.6, // 覆盖当前格子
      row,
      {
        damage: damageValue,
        duration: 200,
        distance: 1.2,
        flying: true,
        invisible: true,
        color: 0x00ffff,
        alphaFrom: 0.2,
        alphaTo: 0.1,
        faction,
      },
    );
  }

  /** 一次性植物没有实体入口；真实路径走 `applyInstantEffect()`。 */
  public override createEntity(): never {
    throw new Error("MagicPowder is an instant plant; use applyInstantEffect().");
  }
}

// 导出单例数据
export const MagicPowderData = new MagicPowderModel();
