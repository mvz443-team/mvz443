import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import { ArrowModel } from "../../bullet/arrow";
import { PositionManager } from "../../../managers/view/PositionManager";
import { Faction } from "../../../models/Enum";
import { effectiveFaction } from "../../../core/logic/FactionRelations";
import type { Game } from "../../../scenes/Game";
import type { JsonValue } from "../../../core/SimulationState";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import { BOW_WEAPON, SkeletonBowModel, BaseSkeletonBowEntity } from "../../../models/entities/BaseSkeletonBowEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { legacyRapierVelocityToUnitsPerSecond } from "../../../../constants/physics";
import type { EquipmentDef } from "../../../models/equipment/Equipment";

const SHELL_BURST_COUNT = 5;
const SHELL_BURST_INTERVAL_MS = 600;

const TURTLE_SHELL_EVENTS = {
  Burst: "TurtleShellBurst",
} as const;

const TURTLE_SHELL_BOW: EquipmentDef = {
  key: "attach/turtle",
  maxHealth: 375,
  thresholds: [250, 125],
  damageScale: 0.5,
  breakOverflow: "full",
  hitSound: "leatherHit",
  visual: {
    attachment: "fixed",
    x: 0,
    y: -PositionManager.Instance.GRID_SIZEY * 1.15,
    scale: 1.4,
    depth: 13,
  },
};

/** 龟壳数值与破碎后连射都在 Model；Entity 只按 Model 状态渲染龟壳。 */
export class TurtleSkeletonBowModel extends SkeletonBowModel {
  public override get tickEventNames(): readonly string[] {
    return [
      ...DEFAULT_TICK_EVENT_NAMES,
      TURTLE_SHELL_EVENTS.Burst,
    ];
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === TURTLE_SHELL_EVENTS.Burst) {
      this.fireBurstArrow(this.host as MonsterEntity | null);
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  public override onHeadBroken(entity: MonsterEntity): void {
    if (this.buffApplied) return;
    this.buffApplied = true;
    // 时长有界、不可永久；速度/攻速/动画倍率由 buff 系统统一处理。
    this.applyBuff("berserk", 900_000);
    for (let i = 0; i < SHELL_BURST_COUNT; i++) {
      this.tickmanager.schedule(TURTLE_SHELL_EVENTS.Burst, SHELL_BURST_INTERVAL_MS * i);
    }
  }

  private fireBurstArrow(entity: MonsterEntity | null): void {
    if (!entity || entity.currentHealth <= 0) return;
    ProjectileCmd.Create(ArrowModel, entity.scene, entity.x, entity.row, {
      damage: 90,
      faction: effectiveFaction(entity) ?? Faction.ZOMBIE,
      speed: -legacyRapierVelocityToUnitsPerSecond(320),
    });
  }
}

export class TurtleSkeletonBowEntity extends BaseSkeletonBowEntity {
  declare public model: TurtleSkeletonBowModel;

  public constructor(scene: Game, col: number, row: number, model: TurtleSkeletonBowModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const TurtleSkeletonBowData = new TurtleSkeletonBowModel({
  mid: 16,
  nameKey: "TurtleSkeletonBow",
  level: 3,
  weight: (waveID) => Math.min(1800, 1000 + Math.max(waveID - 15, 0) * 40),
  leastWaveID: 10,
  leastWaveIDByStageID: (stageID) => stageID >= 6 ? 6 : 10,
  maxHealth: 250,
  baseSpeed: MonsterSpeed.TurtleSkeletonBow,
  baseAttackDamage: 40,
  attackInterval: ZombieAttackInterval.TurtleSkeletonBow,
  arrowDamage: 50,
  arrowInterval: 2000,
  equipment: { head: TURTLE_SHELL_BOW, mainHand: BOW_WEAPON },
  createEntity: (scene, col, row, model, waveID) => new TurtleSkeletonBowEntity(scene, col, row, model as TurtleSkeletonBowModel, waveID),
});
