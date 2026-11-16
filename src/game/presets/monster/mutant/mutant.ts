import type { ITickTimerHandle } from "../../../core/logic/EntityTickManager";
import { DEFAULT_TICK_EVENT_NAMES, TickEventNameEnums } from "../../../core/logic/TickEvents";
import { BaseMonsterEntity, PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import { PlantEntity } from "../../../models/entities/PlantEntity";
import { createMutantAnimController } from "../../../models/monster/anims/LegacyMonsterAnimControllers";
import type { Game } from "../../../scenes/Game";
import MobCmd from "../../../utils/cmd/MobCmd";
import { MonsterSpeed } from "../../../../constants/game";
import {
  withWeaponEntity,
  withWeaponModel,
  type EquipmentDef,
} from "../../../models/equipment/Equipment";
import type { BaseEntity } from "../../../models/core/BaseEntity";

const mutantProps = {
  Species: "default_mutant",
  bodyKey: "sprMutantBody",
  bodyNum: 2,
  headKey: "sprMutantHead",
  upperArmKey: "sprMutantUpperArm",
  lowerArmKey: "sprMutantLowerArm",
  upperLegKey: "sprMutantUpperLeg",
  lowerLegKey: "sprMutantLowerLeg",
} as const;

const SIGN_WEAPON: EquipmentDef = {
  key: "attach/sign",
  maxHealth: 0,
  thresholds: [],
  visual: { handObject: true },
};

const MutantModelBase = withWeaponModel(PresetMonsterModel);
const MutantEntityBase = withWeaponEntity(BaseMonsterEntity);

/** 武器牌、攻击目标队列、伤害和恢复全部在 Model。 */
export class MutantModel extends MutantModelBase {
  public override readonly tickEventNames = [
    ...DEFAULT_TICK_EVENT_NAMES,
    TickEventNameEnums.MutantRecover,
  ];

  public readonly chargeMs = 1500;
  public readonly recoverMs = 1500;
  public readonly smashDamage = 5500;

  public override onCreate(entity: MutantEntity): void {
    this.equipWeapon(entity, SIGN_WEAPON);
    entity.getLegacyController()?.raw.startBodySwing();
  }

  /** Entity 只转发目标；是否使用特殊攻击由 Model 决定。 */
  public handleAttackTarget(entity: MutantEntity, target: BaseEntity): void {
    if (target instanceof PlantEntity) this.queueAttackTarget(entity, target);
    else this.tryStartAttack(entity, target);
  }

  public canStartMove(entity: MutantEntity): boolean {
    return !entity.isFrozen && !entity.isStop && !entity.isDying && !entity.isAttacking;
  }

  public queueAttackTarget(entity: MutantEntity, plant: PlantEntity): void {
    if (entity.currentHealth <= 0 || entity.isFrozen || entity.isDying) return;
    if (entity.attackedPlants.includes(plant) || entity.preAttackedPlant === plant) return;

    if (entity.isAttacking && entity.attackedPlants.length > 0) {
      const currentGridPlant = entity.attackedPlants[0];
      if (currentGridPlant.col === plant.col && currentGridPlant.row === plant.row) {
        entity.attackedPlants.push(plant);
        return;
      }
      if (!entity.preAttackedPlant) {
        entity.preAttackedPlant = plant;
      }
      return;
    }

    entity.attackedPlants.push(plant);
    this.startAttackProcess(entity);
  }

  public clearAttackState(entity: MutantEntity): void {
    entity.attackTimer?.remove();
    entity.attackTimer = null;
    entity.recoverTimer?.remove();
    entity.recoverTimer = null;
    entity.isAttacking = false;
    entity.attackedPlants = [];
    entity.preAttackedPlant = null;
    entity.attacking = null;
    entity.isStop = false;
    this.onAttackStopped(entity);
  }

  public startAttackProcess(entity: MutantEntity): void {
    if (entity.currentHealth <= 0 || entity.isFrozen || entity.isDying || entity.attackedPlants.length === 0) return;

    entity.stopMove();
    entity.isAttacking = true;
    entity.isStop = true;
    entity.attacking = entity.attackedPlants[0];
    this.onAttackStarted(entity);

    const raw = entity.getLegacyController()?.raw;
    raw?.stopArmSwing?.();
    const attackTargets = [...entity.attackedPlants];

    raw?.startLeftArmSmash?.(() => {
      if (entity.currentHealth <= 0 || entity.isFrozen || entity.isDying) return;

      const cells = attackTargets.map((plant) => ({ col: plant.col, row: plant.row }));
      MobCmd.DamagePlantsInCells(cells, this.smashDamage);

      entity.recoverTimer?.remove();
      entity.recoverTimer = this.tickmanager.schedule(TickEventNameEnums.MutantRecover, this.recoverMs);
    });
  }

  public override handleTickEvent(
    eventName: TickEventNameEnums | string,
    args: import("../../../core/SimulationState").JsonValue = null,
    timerId?: number,
  ): void {
    if (eventName === TickEventNameEnums.MutantRecover) {
      this.finishRecover(this.host as MutantEntity | null);
      return;
    }
    super.handleTickEvent(eventName, args, timerId);
  }

  private finishRecover(entity: MutantEntity | null): void {
    if (!entity || entity.currentHealth <= 0 || entity.isFrozen || entity.isDying) return;

    entity.attackedPlants = [];
    if (entity.preAttackedPlant) {
      entity.attackedPlants.push(entity.preAttackedPlant);
      entity.preAttackedPlant = null;
      this.startAttackProcess(entity);
      return;
    }

    entity.isAttacking = false;
    entity.isStop = false;
    entity.attacking = null;
    this.onAttackStopped(entity);
    entity.startMove();
  }

  public override onHurt(entity: MutantEntity, _damage: number, _realDamage: number) {
    entity.animController.highlight();
    const raw = entity.getLegacyController()?.raw;
    if (!raw?.switchBodyFrame) return;
    if (entity.currentHealth >= entity.maxHealth / 2) {
      raw.switchBodyFrame(0);
    } else if (entity.currentHealth > 0) {
      raw.switchBodyFrame(1);
    }
  }

  public override onDeath(entity: MutantEntity): void {
    this.clearAttackState(entity);
  }
}

export class MutantEntity extends MutantEntityBase {
  declare public model: MutantModel;

  public declare isAttacking: boolean;
  public attackedPlants: PlantEntity[] = [];
  public preAttackedPlant: PlantEntity | null = null;
  public attackTimer: ITickTimerHandle | null = null;
  public recoverTimer: ITickTimerHandle | null = null;

  public constructor(scene: Game, col: number, row: number, model: MutantModel, waveID: number) {
    super(scene, col, row, model, waveID);
    this.isAttacking = false;
  }

  protected createAnimController() {
    return createMutantAnimController(this.scene, this.x, this.y, mutantProps);
  }

  public override startMove() {
    if (!this.model.canStartMove(this)) return;
    this.setVelocityX(-this.speed);
    this.animController.startLegSwing();
    this.animController.startArmSwing();
  }

  public override stopMove() {
    this.setVelocityX(0);
    this.animController.stopLegSwing();
  }

  public override startAttacking(target: BaseEntity) {
    this.model.handleAttackTarget(this, target);
  }

  public clearAttackState(): void {
    this.model.clearAttackState(this);
  }

  public override destroy(): void {
    this.model.clearAttackState(this);
    super.destroy();
  }
}

export const MutantData = new MutantModel({
  mid: 15,
  nameKey: "Mutant",
  level: 8,
  weight: () => 1500,
  leastWaveID: 15,
  maxHealth: 3000,
  baseSpeed: MonsterSpeed.Mutant,
  attackDamage: 5500,
  attackInterval: 1500,
  createEntity: (scene, col, row, model, waveID) => new MutantEntity(scene, col, row, model as MutantModel, waveID),
});
