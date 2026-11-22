import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { EquipmentDef } from "../../../models/equipment/Equipment";
import { ZombieEntity, ZombieModel } from "./zombie";

export const TURTLE_SHELL: EquipmentDef = {
  key: "attach/turtle",
  maxHealth: 370,
  thresholds: [250, 125],
  damageScale: 0.5,
  hitSound: "leatherHit",
  visual: { attachment: "fixed", depth: 13 },
};

/** 龟甲破碎后施加一次性 berserk（900s），加速决策在 Model；Entity 只接收视图刷新。 */
export class TurtleZombieModel extends ZombieModel {
  public override onHeadBroken(entity: MonsterEntity): void {
    if (this.buffApplied) return;
    this.buffApplied = true;
    // 时长有界、不可永久；900s 覆盖一局时长。速度/攻速/动画倍率由 buff 系统统一处理。
    this.applyBuff("berserk", 900_000);
  }
}

export class TurtleZombieEntity extends ZombieEntity {
  declare public model: TurtleZombieModel;

  public constructor(scene: Game, col: number, row: number, model: TurtleZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const TurtleZombieData = new TurtleZombieModel({
  mid: 14,
  nameKey: "TurtleZombie",
  level: 2,
  weight: () => 1200,
  leastWaveID: 4,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.TurtleZombie,
  baseAttackDamage: 20,
  attackInterval: ZombieAttackInterval.TurtleZombie,
  damageThresholds: [150],
  equipment: { head: TURTLE_SHELL },
  createEntity: (scene, col, row, model, waveID) => new TurtleZombieEntity(scene, col, row, model as TurtleZombieModel, waveID),
});
