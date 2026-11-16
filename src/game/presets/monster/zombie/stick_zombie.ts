import type { Game } from "../../../scenes/Game";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import type { CombatEntity } from "../../../models/core/CombatEntity";
import type { CollisionContext } from "../../../types";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { MonsterSpeed, ZombieAttackInterval } from "../../../../constants/game";
import { BaseZombieEntity } from "./zombie";
import { withWeaponEntity, withWeaponModel, type EquipmentDef } from "../../../models/equipment/Equipment";

const STICK_WEAPON: EquipmentDef = {
  key: "attach/hd_stick",
  maxHealth: 0,
  thresholds: [],
  visual: { attachment: "hand", depth: 13 },
};

const StickModelBase = withWeaponModel(PresetMonsterModel);

/** 手杖僵尸的撑杆跳决策在 Model；Entity 只保留抬升表现与视图同步。 */
export class StickZombieModel extends StickModelBase {
  constructor(def: MonsterDefinition) {
    super(def);
    this.hasStick = true;
  }

  public override onCreate(entity: MonsterEntity): void {
    this.equipWeapon(entity, STICK_WEAPON);
  }

  public canVaultOverPlant(target: PlantEntity): boolean {
    return this.hasStick && Boolean(target) && typeof target.col === "number";
  }

  public tryStartVault(entity: MonsterEntity, target: CombatEntity): boolean {
    if (!this.canVaultOverPlant(target as PlantEntity)) return false;
    this.hasStick = false;
    this.isFlying = true;
    entity.setVelocityX(-this.originalSpeed * 2.2);
    this.vaultTargetX = PositionManager.Instance.getGridTopLeft((target as PlantEntity).col, entity.row).x
      - PositionManager.Instance.GRID_SIZEX * 0.25;
    return true;
  }

  public onVaultCollision(entity: MonsterEntity, target: unknown): boolean {
    if (!this.isFlying || !(target instanceof PlantEntity)) return false;
    (entity as any).vaultCollisionTarget = target;
    return true;
  }

  public shouldFinishVault(entity: MonsterEntity): boolean {
    return this.isFlying && entity.x <= this.vaultTargetX;
  }

  public finishVault(entity: MonsterEntity): void {
    this.isFlying = false;
    this.speed = this.originalSpeed * 0.5;
    this.consumeWeapon(entity);

    const target = (entity as any).vaultCollisionTarget as PlantEntity | null;
    (entity as any).vaultCollisionTarget = null;
    if (target && target.currentHealth > 0) {
      this.tryStartAttack(entity, target);
      return;
    }
    entity.startMove();
  }
}

const StickEntityBase = withWeaponEntity(BaseZombieEntity);

export class StickZombieEntity extends StickEntityBase {
  declare public model: StickZombieModel;

  public constructor(scene: Game, col: number, row: number, model: StickZombieModel, waveID: number) {
    super(scene, col, row, model, waveID);
  }

  public canVaultOverPlant(target: PlantEntity): boolean {
    return this.model.canVaultOverPlant(target);
  }

  public override startAttacking(target: CombatEntity): void {
    if (this.model.tryStartVault(this, target)) return;
    if (this.model.isFlying) return;
    super.startAttacking(target);
  }

  public override onCollision(ctx: CollisionContext): void {
    if (this.model.onVaultCollision(this, ctx.targetEntity)) return;
    super.onCollision(ctx);
  }

  public override stepUpdate(): void {
    super.stepUpdate();
    if (this.model.shouldFinishVault(this)) this.model.finishVault(this);
  }

  public override updateView(vec: { x: number; y: number }): void {
    super.updateView(vec);
    if (this.model.isFlying) {
      this.animController.updatePosition(this.x + this.offsetX, this.y + this.offsetY - PositionManager.Instance.GRID_SIZEY * 0.4);
    }
  }
}

export const StickZombieData = new StickZombieModel({
  mid: 8,
  nameKey: "StickZombie",
  level: 2,
  weight: () => 2000,
  leastWaveID: 9,
  maxHealth: 300,
  baseSpeed: MonsterSpeed.StickZombie,
  attackDamage: 30,
  attackInterval: ZombieAttackInterval.StickZombie,
  createEntity: (scene, col, row, model, waveID) => new StickZombieEntity(scene, col, row, model as StickZombieModel, waveID),
});
