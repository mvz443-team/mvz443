import type { EntityRandom } from "../../../core/DeterministicRandom";
import { PhaserEventBus, PhaserEvents } from "../../../EventBus";
import { PositionManager } from "../../../managers/view/PositionManager";
import { createGolemAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { Game } from "../../../scenes/Game";
import { GolemAnimProps } from "../../../sprite/golem";
import MobCmd from "../../../utils/cmd/MobCmd";
import StageHelper from "../../../utils/helper/StageHelper";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { BaseMonsterEntity, PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { JsonValue } from "../../../core/SimulationState";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import SoundCmd from "../../../utils/cmd/SoundCmd";
import CombatManager from "../../../managers/CombatManager";

const GOLEM_EVENTS = {
  Begin: "GolemBegin",
  Cast: "GolemCast",
  ArmStop: "GolemArmStop",
  Reposition: "GolemReposition",
  SummonNext: "GolemSummonNext",
} as const;

export const GOLEM_TICK_EVENT_NAMES = [
  ...DEFAULT_TICK_EVENT_NAMES,
  ...Object.values(GOLEM_EVENTS),
];

/** Golem 技能状态机与召唤决策全部在 Model；Entity 只提供动画/物理表现。 */
export class GolemModel extends PresetMonsterModel {
  public override readonly tickEventNames: readonly string[] = GOLEM_TICK_EVENT_NAMES;

  public pendingSpawns: number[] = [];
  private nextSkill: 1 | 2 = 1;

  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(_entity: MonsterEntity): void {
    this.tickmanager.schedule(GOLEM_EVENTS.Begin, 2500);
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    const entity = this.host as BaseGolemEntity | null;
    if (!entity) return;
    if (eventName === GOLEM_EVENTS.Begin) {
      if (entity.currentHealth <= 0) return;
      entity.onGolemBegin();
      this.runCycle(entity);
      this.callMob(entity);
      return;
    }
    if (eventName === GOLEM_EVENTS.Cast) {
      if (entity.currentHealth <= 0) return;
      entity.animController.startArmSwing();
      if (this.readSkillArg(args) === 1) this.skill1(entity);
      else this.skill2(entity);
      this.tickmanager.schedule(GOLEM_EVENTS.ArmStop, 3200);
      return;
    }
    if (eventName === GOLEM_EVENTS.ArmStop) {
      entity.onGolemArmStop();
      this.tickmanager.schedule(GOLEM_EVENTS.Reposition, entity.getGolemRecoverDelay());
      return;
    }
    if (eventName === GOLEM_EVENTS.Reposition) {
      entity.repositionGolem(() => this.runCycle(entity));
      return;
    }
    if (eventName === GOLEM_EVENTS.SummonNext) {
      this.spawnNextBatch(entity);
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  /** 默认回落到 Entity 的表现入口；子类 Model 可覆写以承载技能决策。 */
  public skill1(entity: BaseGolemEntity): void {
    (entity as any).skill1();
  }

  public skill2(entity: BaseGolemEntity): void {
    (entity as any).skill2();
  }

  private readSkillArg(args: JsonValue): 1 | 2 {
    return args && typeof args === "object" && !Array.isArray(args) && (args as any).skill === 2 ? 2 : 1;
  }

  private runCycle(entity: BaseGolemEntity): void {
    this.nextSkill = this.nextSkill === 1 ? 2 : 1;
    this.tickmanager.schedule(GOLEM_EVENTS.Cast, entity.getGolemCastDelay(), {
      args: { skill: this.nextSkill },
    });
  }

  private callMob(entity: BaseGolemEntity): void {
    const allowed = [1, 2, 3, 8, 5, 7, 9, 11, 14, 15, 16];
    const levelSum = entity.getGolemCallBase() + (this.callCount % 3) * 10;
    const records = StageHelper.generateBossWaveScript(
      levelSum, entity.getRandom(), allowed, this.callCount,
    );
    this.callCount++;

    const mids: number[] = [];
    for (const record of records) {
      for (let i = 0; i < record.count; i++) mids.push(record.mid);
    }
    entity.shuffleRandom(mids);
    this.pendingSpawns = mids;
    this.spawnNextBatch(entity);
  }

  private spawnNextBatch(entity: BaseGolemEntity): void {
    if (entity.currentHealth <= 0 || this.pendingSpawns.length === 0) return;
    const random = entity.getRandom();
    const batch = Math.min(4 + Math.floor(random() * 4), this.pendingSpawns.length);
    for (let i = 0; i < batch; i++) {
      const mid = this.pendingSpawns.shift();
      if (mid === undefined) break;
      const row = Math.floor(random() * PositionManager.Instance.Row_Number);
      MobCmd.Spawn(mid, entity.scene, PositionManager.Instance.Col_Number, row, -10);
    }
    if (this.pendingSpawns.length > 0) {
      this.tickmanager.schedule(
        GOLEM_EVENTS.SummonNext,
        4500 + Math.floor(random() * 2500),
      );
    }
  }
}

export abstract class BaseGolemEntity extends BaseMonsterEntity {
  declare public model: GolemModel;
  /** PRNG 状态单独走 PRNG 快照；callCount 由 Model 自动追踪。 */
  protected readonly random: EntityRandom;

  protected constructor(scene: Game, col: number, row: number, model: GolemModel, waveID: number, seedFactor: number) {
    super(scene, col, row, model, waveID);
    this.callCount = 0;
    this.random = this.initializeEntityRandom(`golem:${seedFactor}`, CombatManager.Instance.seed * seedFactor);
    PhaserEventBus.emit(PhaserEvents.BossHealth, { health: 100 });
    SoundCmd.CoverBgm("bgm1");
  }

  protected abstract createProps(): GolemAnimProps;
  protected abstract skill1(): void;
  protected abstract skill2(): void;
  protected abstract reposition(done: () => void): void;
  protected abstract getCallBase(): number;
  protected abstract getCastDelay(): number;
  protected abstract getRecoverDelay(): number;

  public getRandom(): EntityRandom { return this.random; }
  public randomInt(maxExclusive: number): number { return Math.floor(this.random() * maxExclusive); }
  public shuffleRandom<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.randomInt(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  public getGolemCallBase(): number { return this.getCallBase(); }
  public getGolemCastDelay(): number { return this.getCastDelay(); }
  public getGolemRecoverDelay(): number { return this.getRecoverDelay(); }

  public onGolemBegin(): void {
    this.stopMove();
    this.animController.stopLegSwing();
  }

  public onGolemSkillCast(skill: 1 | 2): void {
    this.animController.startArmSwing();
    if (skill === 1) this.skill1();
    else this.skill2();
  }

  public onGolemArmStop(): void {
    this.animController.stopArmSwing();
  }

  public repositionGolem(done: () => void): void {
    this.reposition(done);
  }

  protected createAnimController() {
    return createGolemAnimController(this.scene, this.x, this.y, this.createProps());
  }

  public override startMove(): void {
    this.stopMove();
  }

  public override takeDamage(amount: number): void {
    super.takeDamage(amount);
    if (this.currentHealth > 0) MobCmd.EmitBossHealth(this);
  }

  public override destroy(): void {
    PhaserEventBus.emit(PhaserEvents.BossHealth, { health: -1 });
    SoundCmd.BackToPreviousBgm();
    super.destroy();
  }
}
