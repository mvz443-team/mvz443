import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { EquipmentDef } from "../../../models/equipment/Equipment";
import { AXE_WEAPON, BaseVindicatorEntity, VindicatorModel } from "./vindicator";

const WOODEN_SHIELD: EquipmentDef = {
  key: "attach/hd_shield",
  maxHealth: 1000,
  thresholds: [500],
  damageScale: 0.5,
  hitSound: "ironHit",
  blockHitKinds: ["bullet"],
  blockDirection: "facing",
  pierceHitKinds: ["laser", "explosion"],
  breakOverflow: "full",
  visual: {
    attachment: "fixed",
    x: -PositionManager.Instance.GRID_SIZEX * 0.42,
    y: -PositionManager.Instance.GRID_SIZEY * 0.7,
    scale: 2.2,
    originX: 0.5,
    originY: 0.35,
    depth: 13,
  },
};

/** 盾卫：木盾只挡正面 bullet；laser/explosion 同时伤害木盾和本体。 */
export class ShieldVindicatorModel extends VindicatorModel { }

export class ShieldVindicatorEntity extends BaseVindicatorEntity {
  declare public model: ShieldVindicatorModel;

  public constructor(scene: Game, col: number, row: number, model: ShieldVindicatorModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }
}

export const VindicatorSoliderData = new ShieldVindicatorModel({
  mid: 11,
  nameKey: "VindicatorSolider",
  level: 4,
  weight: () => 3500,
  leastWaveID: 14,
  maxHealth: 360,
  baseSpeed: MonsterSpeed.VindicatorSolider,
  attackDamage: 32,
  attackInterval: ZombieAttackInterval.VindicatorSolider,
  damageThresholds: [180],
  equipment: { mainHand: AXE_WEAPON, offHand: WOODEN_SHIELD },
  createEntity: (scene, col, row, model, waveID) => new ShieldVindicatorEntity(scene, col, row, model as ShieldVindicatorModel, waveID),
});
