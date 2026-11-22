import MobManager from "../../managers/combat/MobManager";
import PlantsManager from "../../managers/combat/PlantsManager";
import { PositionManager } from "../../managers/view/PositionManager";
import { Faction } from "../../models/Enum";
import { effectiveFaction, isHostile } from "../../core/logic/FactionRelations";



namespace CombatHelper {
  type Point = {
    x: number;
    row: number;
  } | {
    col: number;
    row: number;
  } | '-inf' | '+inf';

  type Range = {
    start: Point;
    end: Point;
  }

  export function HasFactionBetween(faction: Faction, range: Range): boolean {
    // 遍历 PlantsManager 中的所有植物；阵营比较统一走 effectiveFaction，
    // 兼容被魅惑后临时改阵营的植物与 PvP 的 player1/player2。
    for (const plants of PlantsManager.Instance.PlantsMap.values()) {
      for (const plant of plants) {
        if (effectiveFaction(plant) === faction && isPointInRange(plant.col, range)) {
          return true;
        }
      }
    }
    return false;
  }

  // 仅在指定行上检查是否存在指定阵营，减少判断开销
  export function HasFactionBetweenSingleRow(faction: Faction, range: Range, row: number): boolean {
    for (const plants of PlantsManager.Instance.PlantsMap.values()) {
      for (const plant of plants) {
        if (plant.row === row && effectiveFaction(plant) === faction && isPointInRange(plant.col, range)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 检查指定行的指定范围内是否存在敌对阵营
   * 用于有限范围的射击植物（如南瓜头）
   * @param myFaction 己方阵营
   * @param row 目标行
   * @param centerX 中心 X 坐标（像素）
   * @param leftDistanceGrid 左侧范围（格子数）
   * @param rightDistanceGrid 右侧范围（格子数）
   * @returns 是否在范围内存在敌对阵营
   */
  export function HasEnemyFactionOnRowInDistance(
    myFaction: Faction,
    row: number,
    centerX: number,
    leftDistanceGrid: number,
    rightDistanceGrid: number
  ): boolean {
    // 转换距离为像素
    const leftDistancePx = leftDistanceGrid * PositionManager.Instance.GRID_SIZEX;
    const rightDistancePx = rightDistanceGrid * PositionManager.Instance.GRID_SIZEX;
    const minX = centerX - leftDistancePx;
    const maxX = centerX + rightDistancePx;

    // 检查敌方单位
    const rows = MobManager.Instance.MobsByLane.get(row) ?? [];
    for (const mob of rows) {
      if (isHostile(myFaction, mob) && mob.x >= minX && mob.x <= maxX) {
        return true;
      }
    }

    // 检查敌方植物
    for (const plants of PlantsManager.Instance.PlantsMap.values()) {
      for (const plant of plants) {
        if (
          plant.row === row &&
          isHostile(myFaction, plant) &&
          plant.x >= minX &&
          plant.x <= maxX
        ) {
          return true;
        }
      }
    }

    return false;
  }

  // 为发射系列的植物提供一个专门的接口，检查指定范围内是否存在，以决定是否发射
  export function HasFactionOnRow(faction: Faction, row: number): boolean {
    const rows = MobManager.Instance.MobsByLane.get(row) ?? [];
    for (const mob of rows) {
      if (effectiveFaction(mob) === faction) return true;
    }
    for (const plants of PlantsManager.Instance.PlantsMap.values()) {
      for (const plant of plants) {
        if (plant.row === row && effectiveFaction(plant) === faction) return true;
      }
    }
    return false;
  }

  export function HasEnemyFactionOnRow(myFaction: Faction, row: number): boolean {
    const rows = MobManager.Instance.MobsByLane.get(row) ?? [];
    for (const mob of rows) {
      if (isHostile(myFaction, mob)) return true;
    }
    for (const plants of PlantsManager.Instance.PlantsMap.values()) {
      for (const plant of plants) {
        if (plant.row === row && isHostile(myFaction, plant)) return true;
      }
    }
    return false;
  }

  // 辅助函数：检查点是否在范围内
  function isPointInRange(col: number, range: Range): boolean {
    const startCol = getCol(range.start);
    const endCol = getCol(range.end);

    if (startCol === null || endCol === null) {
      return false;
    }

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    return col >= minCol && col <= maxCol;
  }

  // 辅助函数：从 Point 中提取 col
  function getCol(point: Point): number | null {
    if (point === '-inf') return Number.NEGATIVE_INFINITY;
    if (point === '+inf') return Number.POSITIVE_INFINITY;
    if ('col' in point) return point.col;
    if ('x' in point) return point.x;
    return null;
  }
}
export default CombatHelper;