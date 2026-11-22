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
  durabilityPerUse: 1,
  visual: { attachment: "hand", depth: 13 },
};

const SKELETON_BOW_EVENTS = {
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
    this.tickmanager.schedule(SKELETON_BOW_EVENTS.Shoot, this.arrowInterval, { loop: true });
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
      excludeFactions: [this.faction],
      ignoreBounce: true,
    });
  }

  /** 视线查询由视图侧加速结构提供，是否射击由 Model 决定。 */
  public hasSightTarget(): boolean {
    return this.sightLine.hasTarget();
  }
}
