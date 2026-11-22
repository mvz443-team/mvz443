import type { JsonValue } from "../../../../game/core/SimulationState";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import { createZombieAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { Game } from "../../../scenes/Game";
import MobCmd from "../../../utils/cmd/MobCmd";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { VindicatorData } from "./vindicator";
import { BaseZombieEntity } from "./zombie";

const SUMMON_START_AT_MS = 24000;
const SUMMON_INTERVAL_MS = 28000;
const SUMMON_COUNT = 3;
const SUMMON_RECOVER_MS = 3000;

const EVOKER_EVENTS = {
  Summon: "EvokerSummon",
  Resume: "EvokerResume",
} as const;

/**
 * Evoker 的召唤逻辑完全在 Model 中：
 * timer 只保存 (ownerId, TickEventNameEnums, TriggerFrame)，到点由 HandleTickEvent 派发。
 */
export class EvokerModel extends PresetMonsterModel {
  public override get tickEventNames(): readonly string[] {
    return [
      ...DEFAULT_TICK_EVENT_NAMES,
      EVOKER_EVENTS.Summon,
      EVOKER_EVENTS.Resume,
    ];
  }

  public override onCreate(entity: MonsterEntity): void {
    this.tickmanager.schedule(EVOKER_EVENTS.Summon, SUMMON_INTERVAL_MS, {
      startAt: SUMMON_START_AT_MS,
      repeat: SUMMON_COUNT,
    });
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    const entity = this.host as MonsterEntity | null;
    if (eventName === EVOKER_EVENTS.Summon) {
      this.summonVindicator(entity);
      return;
    }
    if (eventName === EVOKER_EVENTS.Resume) {
      this.resumeAfterSummon(entity);
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private summonVindicator(entity: MonsterEntity | null): void {
    if (!entity || this.isFrozen || entity.currentHealth <= 0) return;

    entity.stopAttacking();
    entity.stopMove();
    entity.animController.stopLegSwing();
    entity.animController.startArmSwing();

    const entries = [
      [entity.col + 1, entity.row],
      [Math.max(0, entity.col - 1), entity.row],
      [entity.col, entity.row - 1],
      [entity.col, entity.row + 1],
    ];
    for (const [col, row] of entries) {
      MobCmd.Spawn(VindicatorData.mid, entity.scene, col, row, -10);
    }

    this.tickmanager.schedule(EVOKER_EVENTS.Resume, SUMMON_RECOVER_MS);
  }

  private resumeAfterSummon(entity: MonsterEntity | null): void {
    if (!entity || entity.currentHealth <= 0 || this.isFrozen) return;
    entity.animController.stopArmSwing();
    entity.startMove();
  }
}

export const EvokerData = new EvokerModel({
  mid: 9,
  nameKey: "Evoker",
  level: 5,
  weight: () => 1000,
  leastWaveID: 10,
  maxHealth: 400,
  baseSpeed: MonsterSpeed.Evoker,
  attackDamage: 20,
  attackInterval: ZombieAttackInterval.Evoker,
  damageThresholds: [160],
  createEntity: (scene, col, row, model, waveID) => new EvokerEntity(scene, col, row, model, waveID),
});

/** Entity 只负责视图与动画控制器，所有技能决策在 EvokerModel。 */
export class EvokerEntity extends BaseZombieEntity {
  declare protected damageThresholds: number[];

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);  }

  protected override createAnimController() {
    return createZombieAnimController("evoker", this.scene, this.x, this.y);
  }
}
