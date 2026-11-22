import { legacyRapierVelocityToUnitsPerSecond } from "../../../constants/physics";
import { ProjectileCmd } from "../../utils/cmd/ProjectileCmd";
import { ArrowModel } from "../../presets/bullet/arrow";
import { Faction } from "../Enum";
import type { Game } from "../../scenes/Game";
import type { JsonValue } from "../../core/SimulationState";
import { DEFAULT_TICK_EVENT_NAMES } from "../../core/logic/TickEvents";
import type { MonsterEntity } from "./MonsterEntity";
import type { EquipmentDef } from "../equipment/Equipment";
import { MediumMonsterModel } from "../monster/MediumMonsterModel";
import { BaseSkeletonEntity } from "../../presets/monster/zombie/skeleton";
import { PositionManager } from "../../managers/view/PositionManager";
import { SightLineEntity } from "./SightLineEntity";

export const BOW_WEAPON: EquipmentDef = {
  key: "attach/hd_bow",
  maxHealth: 300,
  thresholds: [],
  weaponDamage: 0,
  durabilityPerUse: 1,
  visual: { attachment: "hand", depth: 13 },
};

export const SKELETON_BOW_EVENTS = {
  Shoot: "SkeletonBowShoot",
  Resume: "SkeletonBowResume",
} as const;

/** 骨架弓手的射击决策与时序都在 Model；Entity 只提供视线查询与视角能力。 */
export class SkeletonBowModel extends MediumMonsterModel {
  public override get tickEventNames(): readonly string[] {
    return [
      ...DEFAULT_TICK_EVENT_NAMES,
      SKELETON_BOW_EVENTS.Shoot,
      SKELETON_BOW_EVENTS.Resume,
    ];
  }

  public get arrowDamage(): number {
    return this.definition.arrowDamage ?? 70;
  }

  public get arrowInterval(): number {
    return this.definition.arrowInterval ?? 3500;
  }

  public override onCreate(entity: MonsterEntity): void {
    this.rebuildRangedTimers();
  }

  /** buff 冻结时清掉射击循环与恢复计时。 */
  protected override clearRangedTimers(): void {
    this.tickmanager.removeByEvent(SKELETON_BOW_EVENTS.Shoot);
    this.tickmanager.removeByEvent(SKELETON_BOW_EVENTS.Resume);
  }

  /** 远程射击的有效间隔：基于 arrowInterval，与近战 attackInterval 分开。 */
  public get effectiveArrowInterval(): number {
    return Math.max(50, this.arrowInterval * this.attackIntervalMultiplier);
  }

  /** 按 buff 调整后的间隔重建射击循环；先清后建，保证只有一条循环。 */
  protected override rebuildRangedTimers(): void {
    this.tickmanager.removeByEvent(SKELETON_BOW_EVENTS.Shoot);
    this.tickmanager.schedule(SKELETON_BOW_EVENTS.Shoot, this.effectiveArrowInterval, { loop: true });
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === SKELETON_BOW_EVENTS.Shoot) {
      this.tryShoot(this.host as BaseSkeletonBowEntity | null);
      return;
    }
    if (eventName === SKELETON_BOW_EVENTS.Resume) {
      const entity = this.host as BaseSkeletonBowEntity | null;
      if (entity) this.onAttackStopped(entity);
      if (entity && entity.currentHealth > 0 && !this.attackingId) entity.startMove();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private tryShoot(entity: BaseSkeletonBowEntity | null): void {
    if (!entity || this.isFrozen || this.attackingId || entity.currentHealth <= 0) return;
    if (!this.isMainHandUsable()) return;
    if (!entity.hasSightTarget()) return;

    entity.stopMove();
    if (entity.currentHealth <= 0) return;
    ProjectileCmd.Create(ArrowModel, entity.scene, entity.x, entity.row, {
      damage: this.arrowDamage,
      faction: Faction.ZOMBIE,
      speed: -legacyRapierVelocityToUnitsPerSecond(320),
    });
    this.onAttackStarted(entity);
    this.onAttackLanded(entity);
    this.tickmanager.schedule(SKELETON_BOW_EVENTS.Resume, 350);
  }
}

export class BaseSkeletonBowEntity extends BaseSkeletonEntity {
  declare public model: SkeletonBowModel;

  private readonly sightLine: SightLineEntity;

  public constructor(scene: Game, col: number, row: number, model: SkeletonBowModel, waveID: number) {
    super(scene, col, row, model, waveID);
    this.sightLine = new SightLineEntity(scene, {
      owner: this,
      row: () => this.GetRow(),
      direction: -1,
      maxDistance: PositionManager.Instance.GRID_SIZEX * 32,
      excludeSelf: true,
      ignoreBounce: true,
    });
  }

  /** 视线查询由视图侧加速结构提供，是否射击由 Model 决定。 */
  public hasSightTarget(): boolean {
    return this.sightLine.hasTarget();
  }
}
