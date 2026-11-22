// models/PlantModel.ts
import { LevelScaledValue } from "../../utils/numbervalue";
import { Game } from "../scenes/Game";
import { BaseEntity } from "./core/BaseEntity";
import { PlantEntity } from "./entities/PlantEntity";
import { LogicModel } from "../core/logic/LogicModel";
import { isShieldPlantPid, pickShieldPlant } from "../utils/helper/PlantTargeting";

/** 可种植的地块类型白名单取值（与 GridProperty.type 对应）。 */
export type PlantSlot = 'ground' | 'water' | 'sky';

/**
 * 错落角色：同一格内最多叠三种植物，角色决定目标选择与伤害路由。
 * - carrier：承载物（睡莲/船），永远不是第一目标；
 * - shield：护罩（南瓜护照），替同格内部植物优先承伤；
 * - normal：正常植物。
 */
export type PlantStackRole = 'normal' | 'carrier' | 'shield';

/**
 * 放置规则：只回答"能否放在这个格子上"，与 `stackRole`（目标选择角色）正交。
 * - normal：常规，受地块白名单与同格植物冲突限制；
 * - overlayAny：忽略同格植物占用（魔术粉），仍受地块规则限制；
 * - overlayExisting：必须种在已有存活植物的格子上（萤石粉）。
 */
export type PlantPlacementRule = 'normal' | 'overlayAny' | 'overlayExisting';

export abstract class PlantModel extends LogicModel {
  /** 以下运行时字段全部自动进入快照；新增字段直接写在这里即可。 */
  public level: number = 1;
  public isSleeping: boolean = false;
  public shieldHealth: number = 0;
  public damagedSum: number = 0;
  public inBruteShoot: boolean = false;
  public isLightning: boolean = false;
  public isBuried: boolean = false;
  public hasExploded: boolean = false;
  public hasTriggered: boolean = false;
  public canActivateFromSleep: boolean = false;
  public fuse: number = 0;
  public explosionDamage: number = 0;
  public customExplodeDamage: number = 0;

  public abstract readonly pid: number;
  public abstract readonly nameKey: string;
  public abstract readonly descriptionKey: string;
  public abstract readonly texturePath: string;

  // 核心数值定义 (使用LevelScaledValue处理等级差异)
  public abstract maxHealth: LevelScaledValue;
  public abstract cost: LevelScaledValue;
  public abstract cooldown: LevelScaledValue; // 单位ms
  public abstract cooldownStartAtRatio: number;// 0-1, 0表示无需等待，立即装填；1表示 游戏开始时需要完整等待cooldown
  public abstract damage: LevelScaledValue;

  public abstract isNightPlant: boolean;

  /**
   * 允许种植的地块白名单；`null` 表示不限制（默认）。
   * 例如 TNT 地雷只能种在普通地面：`['ground']`，
   * 因此它无法种在水面，也就无法种在睡莲上。
   */
  public allowedPlantSlots: readonly PlantSlot[] | null = null;
  /** 错落角色；默认 normal，承载物/护罩由对应 preset 覆写。 */
  public stackRole: PlantStackRole = 'normal';
  /** 放置规则；默认 normal，一次性/特殊叠种由对应 preset 覆写。 */
  public placementRule: PlantPlacementRule = 'normal';
  /**
   * 必须种在哪个 pid 的基座植物上；`null` 表示不要求基座。
   * 当前高级植物：
   * - 南瓜头·晚上（pid 11）→ 阴森南瓜头（pid 9）
   * - 反坦克分发器（pid 14）→ 发射器（pid 1）
   */
  public requiredBasePid: number | null = null;
  /**
   * 一次性植物：种植落地的同一确定性帧直接结算效果，不创建 Entity、物理体或存活定时器。
   * 具体效果由 `applyInstantEffect()` 覆写。
   */
  public isOneTimePlant: boolean = false;
  /** 低矮植物由 `LogicModel.tiny` 表示（只有带 tiny 的投射物能命中）。 */

  protected readonly LevelThresholds1: number;
  protected readonly LevelThresholds2: number;

  // 行为接口：当植物准备就绪
  // 注意：传入的是 entity (实体对象)，Model本身不保存任何状态！
  public onCreate(_entity: PlantEntity) {
  };

  public onSleepStateChange(_entity: PlantEntity, _isSleeping: boolean) {
  };

  // 行为接口：当释放大招(星之碎片)时触发什么？
  public onStarShards(_entity: PlantEntity) {
  };

  public onHurt(_entity: PlantEntity, _damage: number, _realDamage: number, _dealer?: BaseEntity, _source?: BaseEntity) {

  };

  /**
   * 同格护盾植物优先承受伤害（南瓜护照这类保护壳）。
   *
   * @returns true 表示这次伤害已被护盾植物吸收，内部植物不再结算。
   */
  public redirectDamageToShield(
    entity: PlantEntity,
    amount: number,
    dealer?: BaseEntity,
    source?: BaseEntity,
  ): boolean {
    // 护盾植物自己不再转一次，避免自伤递归。
    if (isShieldPlantPid(this.pid)) return false;
    const shield = pickShieldPlant(entity.getCellPlants(), entity);
    if (!shield) return false;
    shield.takeDamage(amount, dealer, source);
    return true;
  }

  public onDeath(_entity: PlantEntity) { };

  /**
   * 一次性植物的落地效果。
   *
   * 由 `PlantsManager` 在 `isOneTimePlant === true` 时于 defer 回调中直接调用，
   * 不创建 Entity / 物理体，也不注册存活定时器；逻辑必须在同一确定性帧内完成。
   */
  public applyInstantEffect(_scene: Game, _col: number, _row: number, _level: number): void { }

  protected initializeEntity<TEntity extends PlantEntity>(entity: TEntity): TEntity {
    return entity.initializeEntity();
  }

  public abstract createEntity(scene: Game, col: number, row: number, level: number): PlantEntity;
}
