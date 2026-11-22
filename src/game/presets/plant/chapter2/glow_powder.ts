import DepthHelper from "../../../utils/helper/DepthHelper";
import { LevelScaledValue } from "../../../../utils/numbervalue";
import { PositionManager } from "../../../managers/view/PositionManager";
import { PlantModel } from "../../../models/PlantModel";
import type { Game } from "../../../scenes/Game";
import PlantHelper from "../../../utils/helper/PlantHelper";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { PowderScatterSfx } from "../../../sfx/powder/PowderScatterSfx";

const SECKILL = 99889988; // 秒杀血量

/**
 * 发光粉（萤石粉）- 一次性唤醒植物。
 *
 * 只能种在已有存活植物的格子上；落地同一确定性帧内唤醒整格所有植物并播放特效，
 * 不创建 Entity / 物理体，也没有存活定时器。
 */
export class GlowPowderModel extends PlantModel {
  public override pid = 17;
  public override nameKey = 'name_glow_powder';
  public override descriptionKey = 'glow_powder_description';
  public override texturePath = 'plant/glow_powder';

  public maxHealth = new LevelScaledValue(SECKILL);
  public cost = new LevelScaledValue(75).setThreshold(5, 50);
  public cooldown = new LevelScaledValue(14000).setDecValue(0.6);
  public cooldownStartAtRatio = 0;
  public damage = new LevelScaledValue(0);
  public isNightPlant = false;

  /** 萤石粉只能种在已有存活植物的格子上。 */
  public override placementRule = 'overlayExisting' as const;
  /** 种植即结算，不存在存活实体。 */
  public override isOneTimePlant = true;

  public override applyInstantEffect(scene: Game, col: number, row: number, _level: number): void {
    // 唤醒整个格子的所有存活植物。
    for (const plant of PlantHelper.GetPlantsInGrid(col, row)) {
      if (plant.currentHealth > 0) {
        plant.setSleeping(false);
      }
    }

    const { x, y } = PositionManager.Instance.getPlantBottomCenter(col, row);
    SfxCmd.Create(PowderScatterSfx, {
      scene,
      x,
      y,
      depth: DepthHelper.Plant.sfx(DepthHelper.Plant.base(row)),
      color: 0xFFFF5A,
      count: 15,
    });
  }

  /** 一次性植物没有实体入口；真实路径走 `applyInstantEffect()`。 */
  public override createEntity(): never {
    throw new Error("GlowPowder is an instant plant; use applyInstantEffect().");
  }
}

export const GlowPowderData = new GlowPowderModel();
export default GlowPowderData;
