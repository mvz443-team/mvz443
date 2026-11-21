import { PositionManager } from "../../../managers/view/PositionManager";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { Faction } from "../../../models/Enum";
import { WardenGolemAnimProps } from "../../../sprite/normal_golem";
import MobCmd from "../../../utils/cmd/MobCmd";
import { ProjectileCmd } from "../../../utils/cmd/ProjectileCmd";
import type { JsonValue } from "../../../core/SimulationState";
import { GolemModel, BaseGolemEntity, GOLEM_TICK_EVENT_NAMES } from "./shared";

const WARDEN_EVENTS = {
  Land: "WardenLand",
  Reposition: "WardenReposition",
} as const;

/** Warden 的技能决策在 Model。 */
export class WardenModel extends GolemModel {
  public override readonly tickEventNames: readonly string[] = [
    ...GOLEM_TICK_EVENT_NAMES,
    WARDEN_EVENTS.Land,
    WARDEN_EVENTS.Reposition,
  ];

  constructor(def: MonsterDefinition) { super(def); }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    const entity = this.host as WardenEntity | null;
    if (eventName === WARDEN_EVENTS.Land && entity) {
      entity.onWardenLand();
      return;
    }
    if (eventName === WARDEN_EVENTS.Reposition && entity) {
      const row = readNumber(args, "row", entity.row);
      const col = readNumber(args, "col", entity.col);
      entity.applyWardenReposition(row, col);
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  public override skill1(entity: BaseGolemEntity): void {
    MobCmd.AnnounceBossSkill(entity.scene, "warden", "sonic_burst");
    ProjectileCmd.CreateLaser(entity.scene, entity.x, entity.row, {
      damage: 1000,
      distance: 13,
      duration: 3500,
      faction: Faction.ZOMBIE,
      color: 0x39c5bb,
      alphaFrom: 0.4,
      alphaTo: 0.9,
    });
  }

  public override skill2(entity: BaseGolemEntity): void {
    MobCmd.AnnounceBossSkill(entity.scene, "warden", "burrow_ambush");
    entity.playWardenHighJump();
    this.tickmanager.schedule(WARDEN_EVENTS.Land, 1000);
  }

  public onWardenLand(entity: WardenEntity): void {
    entity.playWardenLand();
    MobCmd.DamagePlantsArea(entity.col, entity.row, 1, 1, 180);
    MobCmd.Spawn(4, entity.scene, entity.col, entity.row, -10);
    MobCmd.Spawn(5, entity.scene, entity.col, entity.row, -10);
  }

  public beginReposition(entity: WardenEntity, _done: () => void): void {
    entity.playWardenDig();
    const newRow = entity.randomInt(PositionManager.Instance.Row_Number);
    const newCol = entity.getRandom()() > 0.5 ? 8 : 3;
    this.tickmanager.schedule(WARDEN_EVENTS.Reposition, 1600, {
      args: { row: newRow, col: newCol },
    });
  }
}

function readNumber(args: JsonValue, key: string, fallback: number): number {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const value = (args as Record<string, JsonValue>)[key];
    if (typeof value === "number") return value;
  }
  return fallback;
}

export class WardenEntity extends BaseGolemEntity {
  declare public model: WardenModel;

  public constructor(scene: Phaser.Scene & any, col: number, row: number, model: WardenModel, waveID: number) {
    super(scene, col, row, model, waveID, 19);
  }

  protected createProps() { return WardenGolemAnimProps; }
  protected getCallBase() { return 40; }
  protected getCastDelay() { return 4000; }
  protected getRecoverDelay() { return 3000; }

  protected skill1(): void { this.model.skill1(this); }
  protected skill2(): void { this.model.skill2(this); }

  protected reposition(done: () => void): void {
    this.pendingCycleDone = done;
    this.model.beginReposition(this, done);
  }

  private pendingCycleDone: (() => void) | null = null;

  public resumeGolemCycle(): void {
    const done = this.pendingCycleDone;
    this.pendingCycleDone = null;
    done?.();
  }

  public playWardenHighJump(): void { this.getLegacyController()?.raw.highJump?.(); }
  public playWardenLand(): void { this.getLegacyController()?.raw.land?.(); }
  public playWardenDig(): void { this.getLegacyController()?.raw.dig?.(); }

  public onWardenLand(): void { this.model.onWardenLand(this); }

  public applyWardenReposition(row: number, col: number): void {
    const bodyPos = PositionManager.Instance.getZombieBodyCenter(col, row);
    const viewPos = PositionManager.Instance.getZombieBottomCenter(col, row);
    this.col = col;
    this.row = row;
    this.rigidBody?.setTranslation(bodyPos, true);
    this.animController.updatePosition(viewPos.x + this.offsetX, viewPos.y + this.offsetY);
    this.getLegacyController()?.raw.getOut?.();
    this.resumeGolemCycle();
  }
}

export const WardenData = new WardenModel({
  mid: 13,
  nameKey: "Warden",
  level: 999,
  weight: () => 0,
  leastWaveID: 0,
  rank: "elite",
  habitats: ["ground", "water"],
  maxHealth: 18000,
  baseSpeed: 0,
  attackDamage: 60,
  attackInterval: 1200,
  createEntity: (scene, col, row, model, waveID) => new WardenEntity(scene, col, row, model as WardenModel, waveID),
});
