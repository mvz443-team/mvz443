import { SECKILL } from "../../../../../public/constants";
import { PositionManager } from "../../../managers/view/PositionManager";
import { BaseMonsterEntity, PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { CombatEntity } from "../../../models/core/CombatEntity";
import type { Game } from "../../../scenes/Game";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";
import { CentipedeMinionAnimController } from "./centipede_anim";

export const CENTIPEDE_MINION_WIDTH_CELLS = 1.6;

export class CentipedeMinionEntity extends BaseMonsterEntity {
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
    if (target instanceof PlantEntity) {
      PlantCmd.DealDamage(target, SECKILL / 2, this);
      return;
    }
    super.startAttacking(target);
  }
}

export const CentipedeMinionData = new PresetMonsterModel({
  mid: 18,
  nameKey: "CentipedeMinion",
  level: 0,
  weight: () => 0,
  leastWaveID: 99999,
  rank: "normal",
  maxHealth: 500,
  baseSpeed: 20,
  attackDamage: 0,
  attackInterval: 1000,
  couldCarryStarShards: false,
  createEntity: (scene, col, row, model, waveID) => new CentipedeMinionEntity(scene, col, row, model, waveID),
});
