import type { Game } from "../../../scenes/Game";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { BaseEntity } from "../../../models/core/BaseEntity";
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

/**
 * 越杆目标的确定性全序：距离近者优先（原版"遇到的第一个"），
 * 同距按 pid / 稳定 id 兜底。
 *
 * 只用于让判定线返回值与数组插入顺序无关；起跳本身不消费目标植物，
 * 但显式全序可以避免重连后按快照 id 重建实体时选到不同的一株。
 */
function isCloserVaultTarget(a: PlantEntity, b: PlantEntity, fromX: number): boolean {
  const da = fromX - a.x;
  const db = fromX - b.x;
  if (da !== db) return da < db;
  if (a.pid !== b.pid) return a.pid < b.pid;
  const aId = a.SnapshotId ?? "";
  const bId = b.SnapshotId ?? "";
  return aId < bId;
}

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

  /**
   * 是否还能起跳：一次性消耗品是手杖还是坐骑由子类决定。
   * 所有起跳入口（判定线 / 普攻拦截）共用此判定，保证"只跳一次"不重复。
   */
  protected get canVault(): boolean {
    return this.hasStick && !this.flying && !this.isDying && !this.isFrozen;
  }

  /** 落地时消耗跳跃能力：手杖版断杆，坐骑版由子类改为破碎坐骑。 */
  protected consumeVault(entity: MonsterEntity): void {
    this.breakMainHand(entity);
  }

  public canVaultOverPlant(target: PlantEntity): boolean {
    return this.canVault && Boolean(target) && typeof target.col === "number";
  }

  /** 起跳：不再依赖"撞到植物"，判定线命中后直接飞固定距离。 */
  public tryStartVault(entity: MonsterEntity): boolean {
    if (!this.canVault) return false;
    this.hasStick = false;
    this.flying = true;
    entity.setVelocityX(-this.originalSpeed * 2.2);
    this.vaultTargetX = entity.x - PositionManager.Instance.GRID_SIZEX * this.vaultDistance;
    return true;
  }

  /**
   * 普攻入口拦截：撑杆跳优先于啃食。
   *
   * 固定帧里 rapier 的 overlap-start 先于 Entity.stepUpdate 派发，行进中现放的
   * 植物会先走 MonsterModel.tryStartAttack 把 isStop 锁死，本帧的 onModelStep
   * 随即被 isStop 挡在起跳分支外，于是僵尸开啃而不跳。这里在写入任何攻击状态、
   * 创建普攻定时器之前拦截：手杖还在且接触的是可越过的存活植物时直接起跳。
   *
   * 判定只来自 Model 快照字段（hasStick / flying / health）与传入实体类型；
   * 起跳不创建攻击 timer，不触碰 beginAttackTimer 的 removeByEvent 兜底语义，
   * 也不会在重连 / 回滚后留下第二条普攻循环。返回 true 表示本次接触已消费。
   */
  public override tryStartAttack(entity: MonsterEntity, target: BaseEntity): boolean {
    // 飞行中任何接触都不进入啃食；真实碰撞已由 onVaultCollision 吞掉，这里是兜底。
    if (this.flying) return true;
    if (this.tryVaultOnContact(entity, target)) return true;
    return super.tryStartAttack(entity, target);
  }

  private tryVaultOnContact(entity: MonsterEntity, target: BaseEntity): boolean {
    if (!this.canVault) return false;
    if (!(target instanceof PlantEntity)) return false;
    if (target.currentHealth <= 0) return false;
    return this.tryStartVault(entity);
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
      if (!found || isCloserVaultTarget(plant, found, entity.x)) found = plant;
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
    if (!this.canVault || this.isStop) return;
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
    this.consumeVault(entity);

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

  /** 供 TNT 地雷判断"这只僵尸能否越过我"的查询入口，逻辑在 Model。 */
  public canVaultOverPlant(target: PlantEntity): boolean {
    return this.model.canVaultOverPlant(target);
  }

  // 不再覆写 startAttacking：碰撞路径直接走 Model.tryStartAttack，
  // 起跳拦截已下沉到 StickZombieModel.tryStartAttack，Entity 侧保持纯胶水。

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
