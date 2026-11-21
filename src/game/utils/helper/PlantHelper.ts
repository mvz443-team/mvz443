import { GridProperty } from "../../managers/combat/GridManager";
import PlantsManager from "../../managers/combat/PlantsManager";
import { PlantEntity } from "../../models/entities/PlantEntity";
import type { PlantModel, PlantSlot } from "../../models/PlantModel";
import { MagicPowderData } from "../../presets/plant/chapter1/magic_powder";
import {
  isCarrierPlantPid,
  isShieldPlantPid,
  pickShieldPlant,
  pickStarShardsTarget,
  POWDER_PLANT_PIDS,
  SHIELD_PLANT_PIDS,
} from "./PlantTargeting";

// 特殊的植物种植规则
export const SHIELD_PLANT: readonly number[] = SHIELD_PLANT_PIDS; // 护盾植物,铲除上方时铲除,可以和任何非护盾器械兼容
export const WATER_ONLY_PLANT: number[] = [6];// 水中植物,只能种植在水中
export const SKY_ONLY_PLANT: number[] = [100]; // 船只,只能种植在天空中
export const POWDER_PLANT: readonly number[] = POWDER_PLANT_PIDS; // 粉尘植物,可以随意种植

export const ADVANCED_PLANT: Map<number, number> = new Map([
  [11, 9], [14, 1]
]); // 高级植物,只能种植在基座上, [advancedPid - basicPid]


// 怪物的地形通行规则统一由 TerrainHabitat + MonsterModel.habitats 决定，不再在此维护 pid 白名单。

const lilyPid = 6;
const boatPid = 100; // unknown
const magicPowderPid = MagicPowderData.pid;

namespace PlantHelper {
  export function hasBoat(plants: PlantEntity[]): boolean {
    for (const plant of plants) {
      if (plant.model.pid === boatPid) {
        return true;
      }
    }
    return false;

  }

  export function hasLily(plants: PlantEntity[]): boolean {
    for (const plant of plants) {
      if (plant.model.pid === lilyPid) {
        return true;
      }
    }
    return false;

  }

  // 是否是承载物
  export function isCarrier(pid: number): boolean {
    return isCarrierPlantPid(pid);
  }

  /** 是否是护盾植物（南瓜护照这类包在内部植物外面的壳）。 */
  export function isShield(pid: number): boolean {
    return isShieldPlantPid(pid);
  }

  /** 同格中替内部植物吸收伤害的护盾植物。 */
  export function GetShieldPlant(plants: PlantEntity[], exclude?: PlantEntity | null): PlantEntity | null {
    return pickShieldPlant(plants, exclude);
  }

  /**
   * 星之碎片的目标植物。
   * 与悬停预览共用同一份规则，保证"看到哪个就打到哪个"。
   */
  export function GetStarShardsTarget(
    plants: PlantEntity[],
    aspect: 'up' | 'down',
  ): { pid: number, plantEntity: PlantEntity } | null {
    const target = pickStarShardsTarget(plants, aspect);
    if (!target) return null;
    return { pid: target.pid, plantEntity: target };
  }

  export function isPowder(pid: number): boolean {
    return POWDER_PLANT.includes(pid);
  }

  /**
   * 铲子（pickaxe）要移除的同格植物。
   * 与悬停预览共用同一份规则，保证"看到哪个就铲哪个"。
   */
  export function GetRemovePlantTarget(
    plants: PlantEntity[],
    aspect: 'up' | 'down',
  ): { pid: number, plantEntity: PlantEntity } | null {
    return GetHighestPriorityPlant(plants, aspect);
  }

  /**
   * 只考虑 格子 和 当前格子已有植物 的情况下判断能否种植
   */
  export function CanPlantInGrid(
  existedPlants: PlantEntity[],
  pid: number,
  targetGridProperty: GridProperty,
  model?: PlantModel | null,
): boolean {
    // 地块白名单：Model 声明 allowedPlantSlots 时，只允许列表内的地块类型。
    const allowedSlots = model?.allowedPlantSlots ?? null;
    if (allowedSlots && !allowedSlots.includes(targetGridProperty.type as PlantSlot)) {
      return false;
    }

    // 高级植物专门通道判断
    if (ADVANCED_PLANT.has(pid)) {
      const basicPid = ADVANCED_PLANT.get(pid);
      for (const plant of existedPlants) {
        if (plant.model.pid === basicPid) {
          return true;
        }
      }
      return false;
    }

    // 不考虑任何承载物的情况下,指定plant能否放置
    const canPlantWithoutCarrier = (existedPlants: PlantEntity[], pid: number) => {
      // 先考虑所有特殊植物
      // 粉尘植物,随意种植
      if (isPowder(pid)) {
        return true;
      }

      // lily,只能在水体放置,并且要求该gird 无其他水生植物
      if (pid === lilyPid) {
        for (const plant of existedPlants) {
          if (WATER_ONLY_PLANT.includes(plant.model.pid)) return false;
        }
        return targetGridProperty.type === 'water';
      }

      // TODO: other water only could be planted

      // boat,could only be planted on 'sky', meanwhile, there should be no other 'boat' in the grid
      if (pid === boatPid) {
        return targetGridProperty.type === 'sky' && !hasBoat(existedPlants);
      }

      // TODO: other sky only plant

      // shield could by planted on any type of grid, and can be planted together with any other plants except another shield
      // traverse all pid in plants
      if (SHIELD_PLANT.includes(pid)) {
        for (const plant of existedPlants) {
          if (SHIELD_PLANT.includes(plant.model.pid)) {
            return false;
          }
        }
        return true;
      }
      // normal plant
      // 本格中没有除了上述特殊plant外的其他plant
      for (const plant of existedPlants) {
        if (plant.model.pid !== lilyPid && plant.model.pid !== boatPid && !SHIELD_PLANT.includes(plant.model.pid)) {
          return false;
        }
      }
      return true;
    };

    // 首先判断目标grid的Property
    if (targetGridProperty.type === 'water') {
      if (WATER_ONLY_PLANT.includes(pid)) {
        return canPlantWithoutCarrier(existedPlants, pid);
      }

      if (hasLily(existedPlants)) {
        return canPlantWithoutCarrier(existedPlants, pid);
      }
      return false;
    } else if (targetGridProperty.type === 'sky') {
      if (SKY_ONLY_PLANT.includes(pid)) {
        return canPlantWithoutCarrier(existedPlants, pid);
      }

      // 其实可以直接种植,只不过被火烧而已
      return canPlantWithoutCarrier(existedPlants, pid);
    } else {
      // ground
      return canPlantWithoutCarrier(existedPlants, pid);
    }
  }

  export function GetPlantsInGrid(col: number, row: number): PlantEntity[] {
    const key = `${col}-${row}`;
    return PlantsManager.Instance.PlantsMap.get(key) || [];
  }

  // 一个格子会有多个植物， 这里选择出做优先的
  export function GetHighestPriorityPlant(plants: PlantEntity[], pointer: 'up' | 'down'): {
    pid: number,
    plantEntity: PlantEntity,
  } | null {
    const removeShield = pointer === 'down'; // 鼠标在格子下方,优先移除护盾
    // 获得 pid
    const list = plants;
    if (list.length > 0) {
      if (list.length === 1) {
        // 直接铲除唯一的植物
        return {
          pid: list[0].model.pid,
          plantEntity: list[0],

        }
      } else {
        // 处理多个植物情况
        // 有承载物,而只有两个plant,优先返回非承载物
        if (list.length === 2 && (hasBoat(list) || hasLily(list))) {
          const targetPlant = isCarrier(list[0].model.pid) ? list[1] : list[0];
          return {
            pid: targetPlant.model.pid,
            plantEntity: targetPlant
          }
        }
        // 有护盾,Normal plant(以及还有承载物)
        if (removeShield) { // 鼠标在grid下方,remove shield
          for (const plant of list) {
            if (SHIELD_PLANT.includes(plant.model.pid)) {
              return {
                pid: plant.model.pid,
                plantEntity: plant
              }
            }
          }
        } else {
          // 即使是移除上面的目标,如果只有承载物和护盾,也会在上面的逻辑中返回护盾
          for (const plant of list) {
            if (!SHIELD_PLANT.includes(plant.model.pid) && (!isCarrier(plant.model.pid))) {
              return {
                pid: plant.model.pid,
                plantEntity: plant
              }
            }
          }
        }
      }
    }
    return null;
  }

  export function IsMorePriorityPlant(prevPlant: PlantEntity, newPlant: PlantEntity): boolean {
    // 是自己,不转
    if (prevPlant.pid === newPlant.pid) {
      return false;
    }
    // 承载物之上有了新的植物,无条件转移
    if (isCarrier(prevPlant.pid) && !isCarrier(newPlant.pid)) {
      return true;
    }
    // 新plant是护盾,如果prev不是护盾,转
    if (SHIELD_PLANT.includes(newPlant.pid) && !SHIELD_PLANT.includes(prevPlant.pid)) {
      return true;
    }
    // 是以下特殊植物(魔术粉)
    if (newPlant.pid === magicPowderPid) {
      return true;
    }
    return false;
  }

}

export default PlantHelper;