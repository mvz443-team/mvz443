import { DamageConstants } from "../../../../constants/game";
import ObstacleManager from "../../../managers/combat/ObstacleManager";
import PlantsManager from "../../../managers/combat/PlantsManager";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { Faction } from "../../../models/Enum";
import { ObsidianGolemAnimProps } from "../../../sprite/normal_golem";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { ArcSfx } from "../../../sfx/arc/ArcSfx";
import MobCmd from "../../../utils/cmd/MobCmd";
import ObstacleCmd from "../../../utils/cmd/ObstacleCmd";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";
import { ObsidianObstacleData } from "../../obstacle";
import type { JsonValue } from "../../../core/SimulationState";
import { GolemModel, BaseGolemEntity, GOLEM_TICK_EVENT_NAMES } from "./shared";

const OBSIDIAN_EVENTS = {
  Column: "ObsidianColumn",
  ObstacleSpawn: "ObsidianObstacleSpawn",
  Reposition: "ObsidianReposition",
} as const;

/** 黑曜石 Golem 的岩柱生成与范围伤害全部在 Model。 */
export class ObsidianGolemModel extends GolemModel {
  public override readonly tickEventNames: readonly string[] = [
    ...GOLEM_TICK_EVENT_NAMES,
    OBSIDIAN_EVENTS.Column,
    OBSIDIAN_EVENTS.ObstacleSpawn,
    OBSIDIAN_EVENTS.Reposition,
  ];

  constructor(def: MonsterDefinition) {
    super(def);
    this.skill1LastRow = -1;
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    const entity = this.host as ObsidianGolemEntity | null;
    if (eventName === OBSIDIAN_EVENTS.Column && entity) {
      this.spawnColumn(entity, numberArg(args, "col", entity.col), numberArg(args, "row", entity.row));
      return;
    }
    if (eventName === OBSIDIAN_EVENTS.ObstacleSpawn && entity) {
      this.createObstacleAndDamage(
        entity,
        numberArg(args, "col", entity.col),
        numberArg(args, "row", entity.row),
        numberArg(args, "hp", 300),
      );
      return;
    }
    if (eventName === OBSIDIAN_EVENTS.Reposition && entity) {
      entity.applyObsidianReposition(numberArg(args, "row", entity.row));
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  public override skill1(entity: BaseGolemEntity): void {
    MobCmd.AnnounceBossSkill(entity.scene, "obsidian_golem", "obsidian_barrage");
    const rows: number[] = [];
    if (PositionManager.Instance.Row_Number % 2 === 0) {
      if (this.skill1LastRow === -1 || this.skill1LastRow === 1) this.skill1LastRow = 0;
      else this.skill1LastRow = 1;
      for (let r = this.skill1LastRow; r < PositionManager.Instance.Row_Number; r += 2) rows.push(r);
    } else {
      for (let r = 0; r < PositionManager.Instance.Row_Number; r += 2) rows.push(r);
    }
    rows.forEach((row, index) => {
      this.tickmanager.schedule(OBSIDIAN_EVENTS.Column, 800 + index * 600, {
        args: { col: entity.col, row, hp: 300, arcHeight: 800 + index * 100 },
      });
    });
  }

  public override skill2(entity: BaseGolemEntity): void {
    MobCmd.AnnounceBossSkill(entity.scene, "obsidian_golem", "obsidian_guard");
    const rows = [...new Set([entity.row, Math.max(0, entity.row - 1), Math.min(PositionManager.Instance.Row_Number - 1, entity.row + 1)])];
    for (const row of rows) {
      this.spawnColumn(entity, 6, row, 500, 250);
      MobCmd.Spawn(11, entity.scene, 7, row, -10);
    }
  }

  private spawnColumn(entity: BaseGolemEntity, col: number, row: number, hp = 300, arcHeight = 200): void {
    if (ObstacleManager.Instance.HasObstacle(col, row)) return;
    const { x, y } = PositionManager.Instance.getPlantBottomCenter(col, row);
    SfxCmd.Create(ArcSfx, {
      scene: entity.scene,
      x1: entity.x, y1: entity.y,
      x2: x, y2: y,
      texture: "zombie/mob_obsidian",
      duration: 1200,
      arcHeight,
    });
    this.tickmanager.schedule(OBSIDIAN_EVENTS.ObstacleSpawn, 1200, {
      args: { col, row, hp },
    });
  }

  private createObstacleAndDamage(entity: BaseGolemEntity, col: number, row: number, hp: number): void {
    ObstacleCmd.createInGrid(ObsidianObstacleData.oid, entity.scene, col, row, {
      hp,
      faction: Faction.ZOMBIE,
      summoner: entity,
    });
    const plants = PlantsManager.Instance.PlantsMap.get(`${col}-${row}`) ?? [];
    for (const plant of [...plants]) {
      PlantCmd.DealDamage(plant, DamageConstants.SECKILL / 2, entity);
    }
  }

  public beginReposition(entity: ObsidianGolemEntity): void {
    entity.playObsidianHighJump();
    const newRow = entity.randomInt(PositionManager.Instance.Row_Number);
    this.tickmanager.schedule(OBSIDIAN_EVENTS.Reposition, 1200, {
      args: { row: newRow, col: 8 },
    });
  }
}

function numberArg(args: JsonValue, key: string, fallback: number): number {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const value = (args as Record<string, JsonValue>)[key];
    if (typeof value === "number") return value;
  }
  return fallback;
}

export class ObsidianGolemEntity extends BaseGolemEntity {
  declare public model: ObsidianGolemModel;
  private pendingCycleDone: (() => void) | null = null;

  public constructor(scene: Phaser.Scene & any, col: number, row: number, model: ObsidianGolemModel, waveID: number) {
    super(scene, col, row, model, waveID, 7);
  }

  protected createProps() { return ObsidianGolemAnimProps; }
  protected getCallBase() { return 38; }
  protected getCastDelay() { return 7000; }
  protected getRecoverDelay() { return 2000; }

  protected skill1(): void { this.model.skill1(this); }
  protected skill2(): void { this.model.skill2(this); }

  protected reposition(done: () => void): void {
    this.pendingCycleDone = done;
    this.model.beginReposition(this);
  }

  public playObsidianHighJump(): void {
    this.getLegacyController()?.raw.highJump?.(120 * PositionManager.Instance.scaleFactor);
  }

  public applyObsidianReposition(row: number): void {
    const bodyPos = PositionManager.Instance.getZombieBodyCenter(8, row);
    const viewPos = PositionManager.Instance.getZombieBottomCenter(8, row);
    this.col = 8;
    this.row = row;
    this.rigidBody?.setTranslation(bodyPos, true);
    this.animController.updatePosition(viewPos.x + this.offsetX, viewPos.y + this.offsetY);
    this.getLegacyController()?.raw.land?.();
    const done = this.pendingCycleDone;
    this.pendingCycleDone = null;
    done?.();
  }
}

export const ObsidianGolemData = new ObsidianGolemModel({
  mid: 12,
  nameKey: "ObsidianGolem",
  level: 999,
  weight: () => 0,
  leastWaveID: 0,
  rank: "elite",
  habitats: ["ground", "water"],
  canDrown: false,
  maxHealth: 12000,
  baseSpeed: 0,
  attackDamage: 50,
  attackInterval: 1200,
  createEntity: (scene, col, row, model, waveID) => new ObsidianGolemEntity(scene, col, row, model as ObsidianGolemModel, waveID),
});
