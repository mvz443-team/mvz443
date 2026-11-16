import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { BaseEntity } from "../../../models/core/BaseEntity";
import type { Game } from "../../../scenes/Game";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { PositionManager } from "../../../managers/view/PositionManager";
import { BulletEntity } from "../../../models/projectiles/BulletEntity";
import {
  withShieldModel,
  withWeaponModel,
  type EquipmentDef,
} from "../../../models/equipment/Equipment";
import { AXE_WEAPON, BaseVindicatorEntity } from "./vindicator";

function createIronShieldDef(): EquipmentDef {
  return {
    key: "attach/hd_shield",
    maxHealth: 1000,
    thresholds: [500],
    damageScale: 0.5,
    hitSound: "ironHit",
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
}

const ShieldModelBase = withShieldModel(withWeaponModel(PresetMonsterModel));

/** 盾卫的位置判定与减伤在 Model；盾牌与战斧都按 Model 状态渲染。 */
export class ShieldVindicatorModel extends ShieldModelBase {
  private readonly facingX: -1 | 1 = -1;

  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(entity: MonsterEntity): void {
    this.equipWeapon(entity, AXE_WEAPON);
    this.equipShield(entity, createIronShieldDef());
  }

  public override canShieldBlock(_entity: MonsterEntity, source?: BaseEntity): boolean {
    if (!(source instanceof BulletEntity)) return false;
    const bulletVx = source.rigidBody?.linvel().x ?? 0;
    return bulletVx * this.facingX < 0;
  }

  /** 原行为：盾破后本次伤害不再减半，直接结算完整伤害。 */
  public override shieldBreakOverflow(_entity: MonsterEntity, amount: number): number {
    return amount;
  }
}

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
  createEntity: (scene, col, row, model, waveID) => new ShieldVindicatorEntity(scene, col, row, model as ShieldVindicatorModel, waveID),
});
