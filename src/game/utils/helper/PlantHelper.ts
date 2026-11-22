import { GridProperty } from "../../managers/combat/GridManager";
import PlantsManager from "../../managers/combat/PlantsManager";
import { PlantEntity } from "../../models/entities/PlantEntity";
import type { PlantModel, PlantSlot } from "../../models/PlantModel";
import type { Game } from "../../scenes/Game";
import { PlantCmd } from "../../utils/cmd/PlantCmd";
import {
  isCarrierPlantPid,
  isPowderPlantPid,
  isShieldPlantPid,
  pickShieldPlant,
  pickStarShardsTarget,
  SHIELD_PLANT_PIDS,
} from "./PlantTargeting";

// 兼容导出：护盾 pid 列表仍由 PlantTargeting 维护；新增护盾请覆写 preset.stackRole。
export const SHIELD_PLANT: readonly number[] = SHIELD_PLANT_PIDS;

// 怪物的地形通行规则统一由 TerrainHabitat + MonsterModel.habitats 决定，不再在此维护 pid 白名单。

/** 仅水中：白名单恰好只有 water。 */
function isWaterOnly(model: PlantModel | null | undefined): boolean {
  const slots = model?.allowedPlantSlots;
  return !!slots && slots.length === 1 && slots[0] === 'water';
}

/** 仅空中：白名单恰好只有 sky。 */
function isSkyOnly(model: PlantModel | null | undefined): boolean {
  const slots = model?.allowedPlantSlots;
  return !!slots && slots.length === 1 && slots[0] === 'sky';
}

function isAlivePlant(plant: PlantEntity): boolean {
  return (plant.currentHealth ?? 0) > 0;
}

function isCarrierPlant(plant: PlantEntity): boolean {
  return plant.model.stackRole === 'carrier' || isCarrierPlantPid(plant.model.pid);
}

function isShieldPlant(plant: PlantEntity): boolean {
  return plant.model.stackRole === 'shield' || isShieldPlantPid(plant.model.pid);
}

namespace PlantHelper {
  /** 同格是否存在承载物（睡莲/船等，由 stackRole 或兼容表判定）。 */
  export function hasCarrier(plants: PlantEntity[]): boolean {
    return plants.some(isCarrierPlant);
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
   * 只考虑 格子 和 当前格子已有植物 的情况下判断能否种植。
   *
   * 规则来源：
   * - 能种在哪 → `PlantModel.allowedPlantSlots`
   * - 基座关系 → `PlantModel.requiredBasePid`
   * - 叠种方式 → `PlantModel.placementRule` + `PlantModel.stackRole`
   *
   * 不再维护 water/sky/carrier 的 pid 白名单，避免新增植物时漏改 helper。
   */
  export function CanPlantInGrid(
    existedPlants: PlantEntity[],
    pid: number,
    targetGridProperty: GridProperty,
    model?: PlantModel | null,
  ): boolean {
    // 读取不到 Model 时保守拒绝：不同调用点不能各自回落到 pid 硬编码，
    // 否则预览/执行/权威校验会对同一格得出不同结论。
    if (!model) return false;

    // 1) 地块白名单：null 表示不限。
    if (model.allowedPlantSlots
      && !model.allowedPlantSlots.includes(targetGridProperty.type as PlantSlot)) {
      return false;
    }

    // 2) 基座关系：由 preset 声明 `requiredBasePid`。
    if (model.requiredBasePid !== null) {
      return existedPlants.some((plant) => plant.model.pid === model.requiredBasePid);
    }

    // 3) 不考虑承载物时，指定 plant 能否放置。
    const canPlantWithoutCarrier = (): boolean => {
      // 一次性/特殊叠种规则由 Model 声明。
      if (model.placementRule === 'overlayAny') return true;
      if (model.placementRule === 'overlayExisting') {
        return existedPlants.some(isAlivePlant);
      }

      // 仅水中植物：只能水格，且同格不能再有另一株仅水中植物。
      if (isWaterOnly(model)) {
        return targetGridProperty.type === 'water'
          && !existedPlants.some((plant) => isWaterOnly(plant.model));
      }

      // 仅空中植物：只能空域，且同格不能再有承载物。
      if (isSkyOnly(model)) {
        return targetGridProperty.type === 'sky' && !hasCarrier(existedPlants);
      }

      // 承载物：同格只能有一株承载物。
      if (model.stackRole === 'carrier' || isCarrierPlantPid(pid)) {
        return !hasCarrier(existedPlants);
      }

      // 护盾：可种在任意地块，但同格只能有一株护盾。
      if (model.stackRole === 'shield' || isShieldPlantPid(pid)) {
        return !existedPlants.some(isShieldPlant);
      }

      // 普通植物：同格不能有除承载物/护盾外的其他植物。
      return !existedPlants.some((plant) =>
        !isCarrierPlant(plant) && !isShieldPlant(plant)
      );
    };

    // 4) 按目标地块收口。
    if (targetGridProperty.type === 'water') {
      // 水本生植物可以直接种；普通植物必须已有承载物（睡莲/船）。
      if (isWaterOnly(model)) return canPlantWithoutCarrier();
      // 萤石粉这类"必须种在已有植物上"的规则优先于承载物要求。
      if (model.placementRule === 'overlayExisting' && existedPlants.some(isAlivePlant)) {
        return true;
      }
      if (hasCarrier(existedPlants)) return canPlantWithoutCarrier();
      return false;
    }

    // sky / ground 都走通用规则；sky 的"会被火烧"属于战斗逻辑，不是种植限制。
    return canPlantWithoutCarrier();
  }

  export function GetPlantsInGrid(col: number, row: number): PlantEntity[] {
    const key = `${col}-${row}`;
    return PlantsManager.Instance.PlantsMap.get(key) || [];
  }

  /** 找到当前格子里指定 pid 的基座植物；高级植物替换基座时统一走这里。 */
  export function FindBasePlant(
    col: number,
    row: number,
    basePid: number | null,
  ): PlantEntity | null {
    if (basePid === null) return null;
    return GetPlantsInGrid(col, row).find((plant) => plant.model.pid === basePid) ?? null;
  }

  /**
   * 高级植物种植的基本规则：
   * - 只替换 `requiredBasePid` 指定的那一株基座，同格其他植物（睡莲/护盾等）保持原状态；
   * - 替换后无论昼夜都继承基座的睡眠状态。
   *
   * 所有种植路径（卡片、赠送、权威帧）都通过这里创建高级植物，preset 的
   * `createEntity` 只负责实体本身，不再各自处理基座。
   */
  export function CreateEntityWithBaseReplacement(
    scene: Game,
    col: number,
    row: number,
    level: number,
    model: PlantModel,
  ): PlantEntity {
    const base = FindBasePlant(col, row, model.requiredBasePid);
    const inheritedSleeping = base?.isSleeping;

    // 先创建新植物再销毁基座：正在啃咬基座的怪物能在同一次通知里
    // 重新选到刚替换上去的高级植物，而不是短暂看到空位后继续前进。
    const entity = model.createEntity(scene, col, row, level);
    base?.destroy();
    if (inheritedSleeping !== undefined) {
      PlantCmd.SetSleeping(entity, inheritedSleeping);
    }
    return entity;
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
        if (list.length === 2 && hasCarrier(list)) {
          const targetPlant = isCarrierPlant(list[0]) ? list[1] : list[0];
          return {
            pid: targetPlant.model.pid,
            plantEntity: targetPlant
          }
        }
        // 有护盾,Normal plant(以及还有承载物)
        if (removeShield) { // 鼠标在grid下方,remove shield
          for (const plant of list) {
            if (isShieldPlant(plant)) {
              return {
                pid: plant.model.pid,
                plantEntity: plant
              }
            }
          }
        } else {
          // 即使是移除上面的目标,如果只有承载物和护盾,也会在上面的逻辑中返回护盾
          for (const plant of list) {
            if (!isShieldPlant(plant) && !isCarrierPlant(plant)) {
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
    if (isCarrierPlant(prevPlant) && !isCarrierPlant(newPlant)) {
      return true;
    }
    // 新plant是护盾,如果prev不是护盾,转
    if (isShieldPlant(newPlant) && !isShieldPlant(prevPlant)) {
      return true;
    }
    // 一次性粉尘植物（魔术粉/萤石粉）
    if (isPowderPlantPid(newPlant.pid)) {
      return true;
    }
    return false;
  }

}

export default PlantHelper;