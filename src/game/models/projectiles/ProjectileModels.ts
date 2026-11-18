import { _Typedebuffs } from "../../../constants/game";
import { legacyRapierVelocityToUnitsPerSecond } from "../../../constants/physics";
import { PositionManager } from "../../managers/view/PositionManager";
import type { Game } from "../../scenes/Game";
import { CombatEntity } from "../core/CombatEntity";
import { ProjectileEntity } from "../entities/ProjectileEntity";
import { Faction } from "../Enum";
import { BulletEntity } from "./BulletEntity";
import { ExplosionEntity } from "./ExplosionEntity";
import { LaserEntity } from "./LaserEntity";
import { LogicModel, type ModelHost } from "../../core/logic/LogicModel";
import { TickEventNameEnums } from "../../core/logic/TickEvents";
import type { JsonValue } from "../../core/SimulationState";
import { registerProjectileModel } from "../../utils/cmd/ProjectileModelRegistry";


export abstract class ProjectileModel<TConfig, TEntity extends ProjectileEntity<any>> extends LogicModel {
  /** 跨进程重建所需的稳定类型；派生类必须覆盖，不能依赖类名。 */
  public static readonly projectileKind: string = "projectile";

  /** 发射物运行时状态全部定义在 Model，自动进入快照。 */
  public damage: number = 0;
  public currentDamage: number = 0;
  public speed: number = 0;
  /** 投射物阵营会影响碰撞过滤与伤害，必须进入快照/哈希。 */
  public faction: Faction = Faction.PLANT;
  public currentPenetrate: number = 1;
  public penetratePower: number = 1;
  public penetratedPunish: number = 0.5;
  public traveledDistanceX: number = 0;
  public maxDistanceX: number = 0;
  public prevX: number = 0;
  public bounceable: boolean = false;
  public skipTiny: boolean = true;

  /** 通用命中效果；子弹与附魔箭可覆写。 */
  public applyEffect(host: ModelHost, target: unknown): void {
    host.markAttacked(target);
    host.applyDamage(target, this.currentDamage, host.dealer ?? null, host);
    if (this.debuff) host.applyDebuffTo(target, this.debuff, this.debuffDuration);
  }

  // Buff 效果
  public debuff: _Typedebuffs = null;
  public debuffDuration: number = 0;

  public couldAttackFlying = false; // 是否能攻击飞行单位（默认为false，表示只能攻击地面单位）
  // 抽象工厂方法，由具体子类决定如何使用 Config 和 Scene 生成 Entity
  public abstract createEntity(scene: Game, x: number, row: number, config: TConfig): TEntity;

  /** 投射物生命周期统一走纯数据 timer，重建后仍能按事件名销毁。 */
  public override handleTickEvent(
    eventName: TickEventNameEnums | string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === TickEventNameEnums.ProjectileExpire) {
      this.host?.destroySelf();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }
}

export interface ProjectileConfig {
  damage: number;
  faction: Faction;
  dealer?: CombatEntity;

  debuff?: _Typedebuffs;
  debuffDuration?: number;

  couldAttackFlying?: boolean; // 是否能攻击飞行单位（默认为false，表示只能攻击地面单位）
}

export interface BulletConfig extends ProjectileConfig {
  maxDistance?: number;
  bounceable?: boolean; // 是否可以被反弹
  speed?: number; // 子弹速度，单位/秒
  penetratePower?: number; // 穿透能力
  penetratedPunish?: number; // 穿透后伤害衰减系数
  skipTiny?: boolean; // 是否跳过小型单位，默认为true
}

export class BulletModel<TConfig extends BulletConfig = BulletConfig, TEntity extends BulletEntity = BulletEntity> extends ProjectileModel<TConfig, TEntity> {
  public static override readonly projectileKind: string = "bullet";
  public texture: string;
  public override speed: number = legacyRapierVelocityToUnitsPerSecond(500);
  // 穿透能力
  public penetratePower: number = 1;
  public penetratedPunish: number = 0.5; // 穿透后伤害系数

  /** 子弹命中效果：伤害、debuff、穿透衰减全部由 Model 决定。 */
  public override applyEffect(host: ModelHost, target: unknown): void {
    this.currentPenetrate += 1;
    host.markPenetrated(target);
    host.markAttacked(target);
    host.applyDamage(target, this.currentDamage, host.dealer ?? null, host);

    if (this.debuff) host.applyDebuffTo(target, this.debuff, this.debuffDuration);

    if (this.currentPenetrate < this.penetratePower) {
      this.currentDamage = Math.floor(this.currentDamage * this.penetratedPunish);
    } else {
      host.destroySelf();
    }
  }

  createEntity(scene: Game, x: number, row: number, config: TConfig): TEntity {
    return new BulletEntity(scene, x, row, this, config) as TEntity;
  }
}

export interface ExplosionConfig extends ProjectileConfig {
  leftGrid: number;// 本格=0.5，右格=1
  rightGrid: number;
  upGrid: number;
  downGrid?: number;
}

export class ExplosionModel<TConfig extends ExplosionConfig = ExplosionConfig, TEntity extends ExplosionEntity = ExplosionEntity> extends ProjectileModel<TConfig, TEntity> {
  public static override readonly projectileKind: string = "explosion";
  public disableAnime: boolean = false;

  couldAttackFlying = true;

  public createEntity(scene: Game, x: number, row: number, config: TConfig): TEntity {
    return new ExplosionEntity(scene, x, row, this, config) as TEntity;
  }
}

export interface LaserConfig extends ProjectileConfig {
  duration: number;
  distance: number;

  invisible?: boolean;
  color?: number;
  alphaFrom?: number;
  alphaTo?: number;
}

export class LaserModel<TConfig extends LaserConfig = LaserConfig, TEntity extends LaserEntity = LaserEntity> extends ProjectileModel<TConfig, TEntity> {
  public static override readonly projectileKind: string = "laser";
  public duration: number = 400; // 激光持续时间
  public distance: number = 12; // 激光长度(格)

  // 视觉参数
  public invisible: boolean = false;
  public color: number = 0xff8a3d;
  // 透明渐变
  public alphaFrom: number = 0.82;
  public alphaTo: number = 0;

  public createEntity(scene: Game, x: number, row: number, config: TConfig): TEntity {
    const y0 = PositionManager.Instance.getRowCenterY(row); // 获取行中心坐标
    const laserDistance = config.distance ?? this.distance;
    const x2 = x + laserDistance * PositionManager.Instance.GRID_SIZEX;

    return new LaserEntity(scene, x, y0, x2, y0, this, row, config) as TEntity;
  }
}

registerProjectileModel(ExplosionModel.projectileKind, ExplosionModel);
registerProjectileModel(LaserModel.projectileKind, LaserModel);
