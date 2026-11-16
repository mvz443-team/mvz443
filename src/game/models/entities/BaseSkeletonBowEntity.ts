import { legacyRapierVelocityToUnitsPerSecond } from "../../../constants/physics";
import { ProjectileCmd } from "../../utils/cmd/ProjectileCmd";
import { ArrowModel } from "../../presets/bullet/arrow";
import { Faction } from "../Enum";
import type { Game } from "../../scenes/Game";
import type { JsonValue } from "../../core/SimulationState";
import { DEFAULT_TICK_EVENT_NAMES } from "../../core/logic/TickEvents";
import { PresetMonsterModel } from "./MonsterEntity";
import type { MonsterEntity } from "./MonsterEntity";
import type { MonsterDefinition } from "./MonsterEntity";
import { BaseSkeletonEntity } from "../../presets/monster/zombie/skeleton";
import { PositionManager } from "../../managers/view/PositionManager";
import { SightLineEntity } from "./SightLineEntity";
import {
  withShieldEntity,
  withWeaponEntity,
  withWeaponModel,
  type EquipmentDef,
  type IShieldModel,
} from "../equipment/Equipment";
import type { BaseEntity } from "../core/BaseEntity";

export const BOW_WEAPON: EquipmentDef = {
  key: "attach/hd_bow",
  maxHealth: 0,
  thresholds: [],
  visual: { attachment: "hand", depth: 13 },
};

const SKELETON_BOW_EVENTS = {
  Shoot: "SkeletonBowShoot",
  Resume: "SkeletonBowResume",
} as const;

const SkeletonBowModelBase = withWeaponModel(PresetMonsterModel);

/** 骨架弓手的射击决策与时序都在 Model；Entity 只提供视线查询与视角能力。 */
export class SkeletonBowModel extends SkeletonBowModelBase {
  public override readonly tickEventNames: readonly string[] = [
    ...DEFAULT_TICK_EVENT_NAMES,
    SKELETON_BOW_EVENTS.Shoot,
    SKELETON_BOW_EVENTS.Resume,
  ];

  constructor(def: MonsterDefinition) {
    super(def);
    this.arrowDamage = 70;
    this.arrowInterval = 3500;
  }

  public override onCreate(entity: MonsterEntity): void {
    this.equipWeapon(entity, BOW_WEAPON);
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
      this.onAttackStopped(entity);
      if (entity && entity.currentHealth > 0 && !this.attackingId) entity.startMove();
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private tryShoot(entity: BaseSkeletonBowEntity | null): void {
    if (!entity || this.isFrozen || this.attackingId || entity.currentHealth <= 0) return;
    if (!entity.hasSightTarget()) return;

    entity.stopMove();
    if (entity.currentHealth <= 0) return;
    ProjectileCmd.Create(ArrowModel, entity.scene, entity.x, entity.row, {
      damage: this.arrowDamage,
      faction: Faction.ZOMBIE,
      speed: -legacyRapierVelocityToUnitsPerSecond(320),
    });
    this.onAttackStarted(entity);
    this.tickmanager.schedule(SKELETON_BOW_EVENTS.Resume, 350);
  }
}

const SkeletonBowEntityBase = withShieldEntity(withWeaponEntity(BaseSkeletonEntity));

export class BaseSkeletonBowEntity extends SkeletonBowEntityBase {
  declare protected arrowDamage: number;
  declare protected arrowInterval: number;

  private readonly sightLine: SightLineEntity;

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
    this.sightLine = new SightLineEntity(scene, {
      owner: this,
      row: () => this.GetRow(),
      direction: -1,
      maxDistance: PositionManager.Instance.GRID_SIZEX * 32,
      excludeFactions: [this.faction],
      includeTiny: false,
      includeFlying: false,
      ignoreBounce: true,
    });
  }

  /** 视线查询由视图侧加速结构提供，是否射击由 Model 决定。 */
  public hasSightTarget(): boolean {
    return this.sightLine.hasTarget();
  }

  /** 通用护盾路由；是否具有护盾由 Model 的 shieldDef 决定。 */
  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    const shield = this.model as unknown as IShieldModel;
    if (shield.absorbShieldDamage?.(this, amount, dealer, source)) return;
    super.takeDamage(amount, dealer, source);
  }
}
