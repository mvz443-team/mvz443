import type { BaseEntity } from "../../models/core/BaseEntity";
import type { MonsterEntity } from "../../models/entities/MonsterEntity";
import type { PlantEntity } from "../../models/entities/PlantEntity";
import type { MonsterModel } from "../../models/MonsterModel";
import type { PlantModel } from "../../models/PlantModel";
import GridManager from "../../managers/combat/GridManager";
import { PositionManager } from "../../managers/view/PositionManager";
import PlantHelper from "../../utils/helper/PlantHelper";
import { isCarrierPlantPid } from "../../utils/helper/PlantTargeting";

/** 环境不适时每固定逻辑帧扣除的最大生命比例。 */
export const DROWN_RATIO_PER_FRAME = 0.05;

/**
 * 实体中心点当前所在格子是否为水格。
 *
 * 旧规则用"整行有水就溺"，在部分格子崩塌成水路后会把站在陆地格上的怪物误判为落水。
 * 这里改为按实体当前中心点（权威 x/y，来自刚体 translation，与 MonsterModel
 * 的接触判定同源）所在格子实时判定；x/y 进快照，故确定性、可随回滚恢复。
 * 注意不能用实体的出生 col/row：它们不随行走更新。
 */
export function isMonsterCenterOnWater(entity: MonsterEntity): boolean {
  const cell = PositionManager.Instance.GetGridByPos(entity.x, entity.y);
  if (cell.col < 0 || cell.row < 0) return false;
  return GridManager.Instance.GetGridProperty(cell.col, cell.row)?.type === "water";
}

/**
 * 僵尸溺亡：中心点所在格子是水格、且没有存活坐骑保护、且不属于免疫 preset 时，
 * 每帧扣 5% 最大血量。
 * 坐骑（木船/海豚）在架时保护骑手；坐骑被爆炸打碎后骑手暴露在水里开始溺亡。
 */
export function applyMonsterDrowning(entity: MonsterEntity, model: MonsterModel): void {
  if (!model.canDrown || model.isDying || entity.currentHealth <= 0) return;
  if (model.flying || model.inVoid) return;
  if (model.hasMount()) return;
  if (!isMonsterCenterOnWater(entity)) return;
  entity.takeDamage(model.maxHealth * DROWN_RATIO_PER_FRAME);
}

/**
 * 植物溺亡：位于水格且同格没有承载物（睡莲/船）时，每帧扣 5% 最大血量。
 * 承载物自身由 isCarrierPlantPid 判定为受保护，不会被自己的环境淹死。
 */
export function applyPlantDrowning(entity: PlantEntity, model: PlantModel): void {
  if (entity.currentHealth <= 0) return;
  const grid = GridManager.Instance.GetGridProperty(entity.col, entity.row);
  if (!grid || grid.type !== "water") return;
  const plants = PlantHelper.GetPlantsInGrid(entity.col, entity.row);
  if (plants.some((plant) => isCarrierPlantPid(plant.pid))) return;
  entity.takeDamage(model.maxHealth.getValueAt(model.level) * DROWN_RATIO_PER_FRAME);
}

/** 供测试与诊断使用：判断某实体当前是否处于会溺亡的环境。 */
export function isDrowningEnvironment(entity: BaseEntity, isMonster: boolean, hasMount = false): boolean {
  if (isMonster) {
    if (hasMount) return false;
    const cell = PositionManager.Instance.GetGridByPos(entity.x, entity.y);
    if (cell.col < 0 || cell.row < 0) return false;
    return GridManager.Instance.GetGridProperty(cell.col, cell.row)?.type === "water";
  }
  const grid = GridManager.Instance.GetGridProperty(entity.col, entity.row);
  if (!grid || grid.type !== "water") return false;
  return !PlantHelper.GetPlantsInGrid(entity.col, entity.row)
    .some((plant) => isCarrierPlantPid(plant.pid));
}
