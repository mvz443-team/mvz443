import { SECKILL } from "../../../../../public/constants";
import { PositionManager } from "../../../managers/view/PositionManager";
import { BaseMonsterEntity, PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { ColorBlockAnimController } from "../../../models/monster/anims/ColorBlockAnimController";
import { CombatEntity } from "../../../models/core/CombatEntity";
import type { Game } from "../../../scenes/Game";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";

export class CentipedeMinionEntity extends BaseMonsterEntity {
  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  protected createAnimController() {
    const size = PositionManager.Instance.getZombieDisplaySize();
    return new ColorBlockAnimController(this.scene, this.x, this.y, {
      width: size.sizeX * 0.8,
      height: size.sizeY * 0.7,
      fillColor: 0x8b3a62,
      strokeColor: 0x3a1426,
      strokeWidth: 2,
    });
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
