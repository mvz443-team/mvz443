import { DamageConstants } from "../../../../constants/game";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { BaseMonsterEntity, PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { JsonValue } from "../../../core/SimulationState";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { CombatEntity } from "../../../models/core/CombatEntity";
import type { Game } from "../../../scenes/Game";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";
import { CentipedeMinionAnimController } from "./centipede_anim";

export const CENTIPEDE_MINION_WIDTH_CELLS = 1.6;

/** 蜈蚣幼虫的秒杀决策在 Model。 */
export class CentipedeMinionModel extends PresetMonsterModel {
  public override readonly tickEventNames = [...DEFAULT_TICK_EVENT_NAMES];

  constructor(def: MonsterDefinition) { super(def); }

  public shouldInstakill(target: unknown): boolean {
    return target instanceof PlantEntity;
  }

  public instakill(entity: MonsterEntity, target: unknown): void {
    if (target instanceof PlantEntity) {
      PlantCmd.DealDamage(target, DamageConstants.SECKILL / 2, entity);
    }
  }
}

export class CentipedeMinionEntity extends BaseMonsterEntity {
  declare public model: CentipedeMinionModel;
  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected override getPhysicsBodySize(): { sizeX: number; sizeY: number } {
    return {
      sizeX: PositionManager.Instance.GRID_SIZEX * CENTIPEDE_MINION_WIDTH_CELLS,
      sizeY: PositionManager.Instance.getZombieBodySize().sizeY,
    };
  }

  protected createAnimController() {
    return new CentipedeMinionAnimController(this.scene, this.x, this.y);
  }

  public override startAttacking(target: CombatEntity): void {
    if (this.model.shouldInstakill(target)) {
      this.model.instakill(this, target);
      return;
    }
    super.startAttacking(target);
  }
}

export const CentipedeMinionData = new CentipedeMinionModel({
  mid: 18,
  nameKey: "CentipedeMinion",
  level: 0,
  weight: () => 0,
  leastWaveID: 99999,
  rank: "normal",
  habitats: ["ground", "water"],
  maxHealth: 500,
  baseSpeed: 20,
  attackDamage: 0,
  attackInterval: 1000,
  couldCarryStarShards: false,
  createEntity: (scene, col, row, model, waveID) => new CentipedeMinionEntity(scene, col, row, model as CentipedeMinionModel, waveID),
});
