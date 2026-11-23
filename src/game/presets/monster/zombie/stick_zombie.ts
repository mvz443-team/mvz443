import type { Game } from "../../../scenes/Game";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { CombatEntity } from "../../../models/core/CombatEntity";
import type { CollisionContext } from "../../../types";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import PlantsManager from "../../../managers/combat/PlantsManager";
import PlantHelper from "../../../utils/helper/PlantHelper";
import type { ModelHost } from "../../../core/logic/LogicModel";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { BaseZombieEntity, ZombieModel } from "./zombie";
import type { EquipmentDef } from "../../../models/equipment/Equipment";

const STICK_WEAPON: EquipmentDef = {
  key: "attach/hd_stick",
  maxHealth: 450,
  thresholds: [],
  weaponDamage: 0,
  visual: { attachment: "hand", depth: 13 },
};

/** 手杖僵尸的撑杆跳决策在 Model；Entity 只保留抬升表现与视图同步。 */
export class StickZombieModel extends ZombieModel {
  constructor(def: MonsterDefinition) {
    super(def);
    this.hasStick = true;
  }

  /** 起跳判定线长度（格）：从身体中心沿移动方向延伸。 */
  public readonly vaultDetectRange = 0.7;
  /** 一次撑杆跳的飞行距离（格）。 */
  public readonly vaultDistance = 1.4;

  public canVaultOverPlant(target: PlantEntity): boolean {
    return this.hasStick && Boolean(target) && typeof target.col === "number";
  }

  /** 起跳：不再依赖"撞到植物"，判定线命中后直接飞固定距离。 */
  public tryStartVault(entity: MonsterEntity): boolean {
    if (!this.hasStick || this.flying || this.isDying || this.isFrozen) return false;
    this.hasStick = false;
    this.flying = true;
    entity.setVelocityX(-this.originalSpeed * 2.2);
    this.vaultTargetX = entity.x - PositionManager.Instance.GRID_SIZEX * this.vaultDistance;
    return true;
  }

  /**
   * 判定线：身体中心沿移动方向（向左）0.7 格内的第一个存活植物。
   *
   * 用判定线而不是碰撞，是为了在"已经出地的 TNT 地雷""气球TNT"这类
   * 低矮/体积小或刚出现的目标前也能及时起跳。
   */
  public findPlantOnVaultLine(entity: MonsterEntity): PlantEntity | null {
    const gridX = PositionManager.Instance.GRID_SIZEX;
    const left = entity.x - gridX * this.vaultDetectRange;
    const plants = PlantsManager.Instance.GetPlantsByLane(entity.row) ?? [];

    let found: PlantEntity | null = null;
    for (const plant of plants) {
      if (!(plant instanceof PlantEntity)) continue;
      if (plant.currentHealth <= 0) continue;
      if (plant.x < left || plant.x > entity.x) continue;
      if (!found || plant.x < found.x) found = plant;
    }
    return found;
  }

  /** 落地补判：脚下格子里的植物（跳跃期间不会收到新的 overlap 事件）。 */
  public findPlantUnderfoot(entity: MonsterEntity): PlantEntity | null {
    const col = PositionManager.Instance.getColByX(entity.x);
    const plants = PlantHelper.GetPlantsInGrid(col, entity.row);
    let target: PlantEntity | null = null;
    for (const plant of plants) {
      if (plant.currentHealth <= 0) continue;
      if (!target || PlantHelper.IsMorePriorityPlant(target, plant)) target = plant;
    }
    return target;
  }

  public override onModelStep(host: ModelHost): void {
    const entity = host as MonsterEntity;
    if (this.flying || !this.hasStick || this.isDying || this.isFrozen || this.isStop) return;
    if (!this.findPlantOnVaultLine(entity)) return;
    this.tryStartVault(entity);
  }

  public onVaultCollision(entity: MonsterEntity, target: unknown): boolean {
    if (!this.flying || !(target instanceof PlantEntity)) return false;
    (entity as any).vaultCollisionTarget = target;
    return true;
  }

  public shouldFinishVault(entity: MonsterEntity): boolean {
    return this.flying && entity.x <= this.vaultTargetX;
  }

  public finishVault(entity: MonsterEntity): void {
    this.flying = false;
    this.speed = this.originalSpeed * 0.5;
    this.breakMainHand(entity);

    const underfoot = this.findPlantUnderfoot(entity);
    (entity as any).vaultCollisionTarget = null;
    if (underfoot) {
      this.tryStartAttack(entity, underfoot);
      return;
    }
    entity.startMove();
  }
}

export class StickZombieEntity extends BaseZombieEntity {
  declare public model: StickZombieModel;

  public constructor(scene: Game, col: number, row: number, model: StickZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  public canVaultOverPlant(target: PlantEntity): boolean {
    return this.model.canVaultOverPlant(target);
  }

  public override startAttacking(target: CombatEntity): void {
    if (this.model.flying) return;
    // 判定线是主路径；这里保留碰撞兜底（例如植物正好被种在脚下）。
    if (this.model.canVaultOverPlant(target as PlantEntity) && this.model.tryStartVault(this)) return;
    super.startAttacking(target);
  }

  public override onCollision(ctx: CollisionContext): void {
    if (this.model.onVaultCollision(this, ctx.targetEntity)) return;
    super.onCollision(ctx);
  }

  public override stepUpdate(): void {
    super.stepUpdate();
    if (this.model.shouldFinishVault(this)) this.model.finishVault(this);
  }

  public override updateView(vec: { x: number; y: number }): void {
    super.updateView(vec);
    if (this.model.flying) {
      this.animController.updatePosition(this.x + this.offsetX, this.y + this.offsetY - PositionManager.Instance.GRID_SIZEY * 0.4);
    }
  }
}

export const StickZombieData = new StickZombieModel({
  mid: 8,
  nameKey: "StickZombie",
  level: 2,
  weight: () => 2000,
  leastWaveID: 9,
  spawnVariants: { water: 28 },
  maxHealth: 300,
  baseSpeed: MonsterSpeed.StickZombie,
  baseAttackDamage: 30,
  attackInterval: ZombieAttackInterval.StickZombie,
  equipment: { mainHand: STICK_WEAPON },
  createEntity: (scene, col, row, model, waveID) => new StickZombieEntity(scene, col, row, model as StickZombieModel, waveID),
});
