import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import seedrandom from "seedrandom";
import DepthHelper from "../../utils/helper/DepthHelper";
import { FrameTimer } from "../../managers/combat/TickerManager";
import type { Game } from "../../scenes/Game";
import { CollisionContext } from "../../types";
import { IMonsterAnimController } from "../monster/anims/IMonsterAnimController";
import { MonsterModel } from "../MonsterModel";
import { PositionManager } from "../../managers/view/PositionManager";
import { CombatEntity } from "../core/CombatEntity";
import { Faction } from "../Enum";
import CombatManager from "../../managers/CombatManager";
import GridManager from "../../managers/combat/GridManager";
import PlantHelper from "../../utils/helper/PlantHelper";
import { PlantEntity } from "./PlantEntity";
import { BaseEntity } from "../core/BaseEntity";
import { LegacyMonsterAnimController } from "../monster/anims/LegacyMonsterAnimControllers";
import ResourceCmd from "../../utils/cmd/ResourceCmd";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
import { StarShardsOrbitSfx } from "../../sfx/star/StarShardsOrbitSfx";
import { DeathRotateSfx } from "../../sfx/death/DeathRotateSfx";
import { DeathSmokeSfx } from "../../sfx/death/DeathSmokeSfx";
import SoundCmd from "../../utils/cmd/SoundCmd";
import { MONSTER_PRNG_FIELDS, MONSTER_RELATION_FIELDS } from "../../core/logic/LogicRelations";

type DeathSmokeSpawn = {
  x: number;
  y: number;
  displaySize: number;
};

type BoundsGameObject = Phaser.GameObjects.GameObject & {
  getBounds: (output?: Phaser.Geom.Rectangle) => Phaser.Geom.Rectangle;
};

export abstract class MonsterEntity extends CombatEntity {
  declare public scene: Game;
  public model: MonsterModel;
  public waveID: number;

  protected override getRelationFields(): readonly string[] {
    return MONSTER_RELATION_FIELDS;
  }

  protected override getPrngFields(): readonly string[] {
    return MONSTER_PRNG_FIELDS;
  }

  /** 快照中记录 mid，供断线恢复时重建实体。 */
  protected override captureLogicState(): Record<string, import("../../../game/core/SimulationState").JsonValue> {
    return {
      mid: this.model.mid,
      waveID: Number((this.model as unknown as Record<string, unknown>).waveID ?? -1),
      spawnSeq: Number(this.ExtraData?.spawnSeq ?? 0),
    };
  }

  public col: number;
  public row: number;
  declare public x: number;
  declare public y: number;
  public baseDepth: number;

  public health: number;
  public speed: number;
  public originalSpeed: number;
  public isFlying = false;
  public isInVoid = false;
  public isDying = false;
  public isFrozen = false;
  public isStop = false;

  public carryStarShards = false;
  private carriedStarShards = 0;
  private starShardsDropped = false;
  private starOrbitSfx: StarShardsOrbitSfx | null = null;
  public attacking: CombatEntity | null = null;
  protected attackTimer: FrameTimer | null = null;
  protected debuffs: { [key: string]: { remaining: number, timer: FrameTimer } } = {};

  public animController!: IMonsterAnimController;
  public viewGroup: Phaser.GameObjects.Group;
  public attachSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private destroyListeners: Array<(entity: MonsterEntity) => void> = [];
  private initialized = false;

  public offsetX: number;
  public offsetY: number;

  constructor(scene: Game, col: number, row: number, model: MonsterModel, waveID: number) {
    const pos = PositionManager.Instance.getZombieBottomCenter(col, row);
    super(scene, pos.x, pos.y, model.maxHealth, Faction.ZOMBIE, model);
    this.model = model;
    this.col = col;
    this.row = row;
    this.waveID = waveID;

    // 出生偏移必须由 seed 决定（见 applySpawnSeed），不能使用未播种的随机源。
    this.offsetX = 0;
    this.offsetY = 0;
    this.baseDepth = DepthHelper.Mob.base(row, this.offsetY);

    this.health = model.maxHealth;
    this.originalSpeed = model.baseSpeed;
    this.speed = this.originalSpeed;
    this.isFlying = model.isDefaultFlying;
    this.isInVoid = model.isDefaultInVoid;
    this.viewGroup = scene.add.group();
  }

  /**
   * 用确定性种子计算出生偏移；spawnSeq 由 MobManager 单调分配，
   * 保证同一局同一出怪序号的偏移在所有端一致。
   */
  public applySpawnSeed(spawnSeq: number): void {
    const rng = seedrandom.alea(
      `${CombatManager.Instance.seed}:${this.waveID}:${this.col}:${this.row}:${spawnSeq}`,
    );
    this.offsetX = rng() * PositionManager.Instance.GRID_SIZEX / 5;
    this.offsetY = rng() * PositionManager.Instance.GRID_SIZEY / 10;
    this.baseDepth = DepthHelper.Mob.base(this.row, this.offsetY);
  }

  public addDestroyListener(listener: (entity: MonsterEntity) => void) {
    this.destroyListeners.push(listener);
  }

  public addStarShards(amount = 1) {
    if (amount <= 0) return;
    this.carryStarShards = true;
    this.carriedStarShards += amount;
    this.startStarShardsOrbitEffect();
  }

  protected abstract buildView(): void;

  public initializeEntity(): this {
    if (this.initialized) return this;
    this.initialized = true;

    this.buildView();
    this.checkAndAddBoat();
    this.buildPhysics();

    this.playSpawnAudio();
    this.startMove();
    this.model.onCreate(this);
    return this;
  }

  protected getPhysicsBodySize(): { sizeX: number; sizeY: number } {
    return PositionManager.Instance.getZombieBodySize();
  }

  private buildPhysics() {
    const size = this.getPhysicsBodySize();
    const physicsCenter = PositionManager.Instance.getZombieBodyCenterByBottom(this.x, this.y);
    const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(physicsCenter.x, physicsCenter.y);
    rigidBodyDesc.setUserData(this);
    this.rigidBody = this.scene.rapierWorld.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(size.sizeX / 2, size.sizeY / 2);
    colliderDesc.setSensor(true);
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    colliderDesc.setActiveCollisionTypes(
      RAPIER.ActiveCollisionTypes.DEFAULT |
      RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC
    );
    this.scene.rapierWorld.createCollider(colliderDesc, this.rigidBody);
  }

  public override updateView(vec: { x: number, y: number }) {
    if (this.isDying) return;
    const nextPosition = PositionManager.Instance.getZombieBottomCenterByBody(vec.x, vec.y);
    this.x = nextPosition.x;
    this.y = nextPosition.y;

    if (!this.animController.isInAnim) {
      this.animController.updatePosition(this.x + this.offsetX, this.y + this.offsetY);
    }

    this.attachSprites.forEach((sprite) => {
      sprite.x = this.x + this.offsetX;
    });
  }

  public override stepUpdate() {
    if (this.x < PositionManager.Instance.getWorldBounds().left) {
      this.destroy();
      CombatManager.Instance.EndGame(false);
    }
  }

  protected setVelocityX(vx: number) {
    if (!this.rigidBody || this.isDying) return;
    this.rigidBody.setLinvel({ x: vx, y: 0 }, true);
  }

  public startMove() {
    if (this.isFrozen || this.isStop || this.isDying) return;
    this.setVelocityX(-this.speed);
    this.animController.startLegSwing();
  }

  public stopMove() {
    this.setVelocityX(0);
    this.animController.stopLegSwing();
  }

  public startAttacking(target: CombatEntity) {
    if (this.isFrozen || this.attacking === target) return;

    if (target instanceof MonsterEntity) {
      if (target.isFlying && !this.isFlying) return;
      if (target.isInVoid) return;
    }

    if (this.attacking instanceof PlantEntity && target instanceof PlantEntity) {
      if (PlantHelper.IsMorePriorityPlant(this.attacking, target)) {
        this.notifyTargetStopAttacked();
      }
    }

    this.attacking = target;
    this.isStop = true;
    this.stopMove();
    target.underAttackBy.add(this);
    this.animController.startArmSwing();

    this.attackTimer = this.tickmanager.addEvent({
      startAt: this.model.attackInterval,
      delay: this.model.attackInterval,
      callback: () => this.hurtTarget(),
      loop: true,
    });
  }

  public stopAttacking() {
    this.notifyTargetStopAttacked();
    this.animController.stopArmSwing();
    this.attackTimer?.remove();
    this.attackTimer = null;
    this.isStop = false;
    this.startMove();
  }

  protected hurtTarget() {
    const target = this.attacking;
    if (!target || target.currentHealth <= 0) {
      this.stopAttacking();
      return;
    }

    target.takeDamage(this.model.attackDamage, this);

    // `takeDamage` 可能在致死流程中触发 destroy，
    // 并通过 underAttackBy / stopAttacking 把 this.attacking 置空。
    if (this.attacking !== target) {
      return;
    }

    if (target.currentHealth <= 0) {
      this.stopAttacking();
    }
  }

  protected notifyTargetStopAttacked() {
    this.attacking?.underAttackBy.delete(this);
    this.attacking = null;
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (this.currentHealth <= 0 || this.isDying) return;

    const realDamage = Math.min(amount, this.currentHealth);
    this.currentHealth -= amount;
    this.health = this.currentHealth;
    this.model.onHurt(this, amount, realDamage, dealer, source);

    if (this.currentHealth <= 0) {
      this.currentHealth = 0;
      this.health = 0;
      this.ZombieDie();
    }
  }

  public onCollision(ctx: CollisionContext) {
    if (ctx.targetEntity instanceof CombatEntity && ctx.targetEntity.faction !== this.faction) {
      this.startAttacking(ctx.targetEntity);
    }
  }

  public ZombieDie() {
    if (this.isDying) return;
    this.dropCarriedStarShards();
    this.stopAttacking();
    this.playDeathAnimation();
  }

  protected playDeathAnimation() {
    this.isDying = true;
    this.stopStarShardsOrbitEffect();
    this.stopMove();

    if (this.rigidBody) {
      this.scene.rapierWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
    }

    const targets = this.getDeathAnimationTargets();
    SfxCmd.Create(DeathRotateSfx, {
      scene: this.scene,
      targets,
      onComplete: () => this.finishDeathAnimation(targets),
    });
  }

  protected getDeathAnimationTargets(): Phaser.GameObjects.GameObject[] {
    return this.viewGroup.getChildren();
  }

  private finishDeathAnimation(targets: Phaser.GameObjects.GameObject[]): void {
    const smokeSpawns = this.getDeathSmokeSpawns(this.getDeathSmokeBounds(targets));
    this.destroy();
    this.playDeathSmokeAnimation(smokeSpawns);
  }

  private checkAndAddBoat() {
    if (GridManager.Instance.RowPropertyRatio(this.row, "water") > 0) {
      const boatY = this.y + 15 * PositionManager.Instance.scaleFactor;
      const boat1 = this.scene.add.sprite(this.x, boatY, "attach/boat1")
        .setScale(PositionManager.Instance.scaleFactor * 1.4)
        .setOrigin(0.5, 1)
        .setDepth(DepthHelper.Mob.boatBack(this.baseDepth));
      const boat2 = this.scene.add.sprite(this.x, boatY, "attach/boat2")
        .setScale(PositionManager.Instance.scaleFactor * 1.4)
        .setOrigin(0.5, 1)
        .setDepth(DepthHelper.Mob.boatFront(this.baseDepth));
      this.attachSprites.set("boat1", boat1);
      this.attachSprites.set("boat2", boat2);
      this.viewGroup.addMultiple([boat1, boat2]);
    }
  }

  protected playSpawnAudio() {
    const idx = Math.floor(Math.random() * 3) + 1;
    SoundCmd.PlayZombieSpawn(idx);
  }

  protected playDeathSmokeAnimation(spawns = this.getDeathSmokeSpawns(null)) {
    spawns.forEach((spawn, index) => {
      SfxCmd.Create(DeathSmokeSfx, {
        scene: this.scene,
        x: spawn.x,
        y: spawn.y,
        depth: DepthHelper.Mob.deathSmoke(this.baseDepth),
        displaySize: spawn.displaySize,
        playSound: index === 0,
      });
    });
  }

  private getDeathSmokeBounds(targets: Phaser.GameObjects.GameObject[]): Phaser.Geom.Rectangle | null {
    let bounds: Phaser.Geom.Rectangle | null = null;

    targets.forEach((target) => {
      if (!this.hasBounds(target)) return;
      const targetBounds = target.getBounds();
      if (targetBounds.width <= 0 || targetBounds.height <= 0) return;

      if (!bounds) {
        bounds = new Phaser.Geom.Rectangle(
          targetBounds.x,
          targetBounds.y,
          targetBounds.width,
          targetBounds.height,
        );
        return;
      }

      Phaser.Geom.Rectangle.Union(bounds, targetBounds, bounds);
    });

    return bounds;
  }

  private hasBounds(target: Phaser.GameObjects.GameObject): target is BoundsGameObject {
    return typeof (target as Partial<BoundsGameObject>).getBounds === "function";
  }

  private getDeathSmokeSpawns(bounds: Phaser.Geom.Rectangle | null): DeathSmokeSpawn[] {
    const rect = bounds ?? this.getFallbackDeathSmokeBounds();
    const gridX = PositionManager.Instance.GRID_SIZEX;
    const gridY = PositionManager.Instance.GRID_SIZEY;
    const displaySize = Phaser.Math.Clamp(Math.min(gridX, gridY) * 0.52, 34, 52);
    const smokeCount = this.model.rank === "boss"
      ? 18
      : Phaser.Math.Clamp(Math.ceil(rect.width / Math.max(1, gridX * 0.18)) + 4, 8, 12);
    const pattern = [
      { x: 0.10, y: 0.72, size: 1.00 },
      { x: 0.22, y: 0.50, size: 0.92 },
      { x: 0.34, y: 0.68, size: 1.06 },
      { x: 0.46, y: 0.44, size: 0.88 },
      { x: 0.58, y: 0.66, size: 1.02 },
      { x: 0.70, y: 0.42, size: 0.94 },
      { x: 0.82, y: 0.62, size: 1.08 },
      { x: 0.92, y: 0.78, size: 0.90 },
      { x: 0.16, y: 0.34, size: 0.84 },
      { x: 0.28, y: 0.82, size: 0.94 },
      { x: 0.40, y: 0.26, size: 1.00 },
      { x: 0.52, y: 0.86, size: 0.86 },
      { x: 0.64, y: 0.28, size: 0.98 },
      { x: 0.76, y: 0.82, size: 0.92 },
      { x: 0.88, y: 0.36, size: 0.86 },
      { x: 0.24, y: 0.22, size: 0.80 },
      { x: 0.50, y: 0.18, size: 0.82 },
      { x: 0.74, y: 0.20, size: 0.80 },
    ];

    return pattern.slice(0, smokeCount).map((point) => ({
      x: rect.left + rect.width * point.x,
      y: rect.top + rect.height * point.y,
      displaySize: displaySize * point.size,
    }));
  }

  private getFallbackDeathSmokeBounds(): Phaser.Geom.Rectangle {
    const widthScale = this.model.rank === "boss" ? 2.4 : 1.15;
    const heightScale = this.model.rank === "boss" ? 1.7 : 1.1;
    const width = PositionManager.Instance.GRID_SIZEX * widthScale;
    const height = PositionManager.Instance.GRID_SIZEY * heightScale;

    return new Phaser.Geom.Rectangle(
      this.x + this.offsetX - width / 2,
      this.y + this.offsetY - height,
      width,
      height,
    );
  }

  private dropCarriedStarShards() {
    if (this.starShardsDropped || !this.carryStarShards) return;
    this.starShardsDropped = true;
    ResourceCmd.AddStarshardToAll(Math.max(1, this.carriedStarShards));
    this.carryStarShards = false;
    this.carriedStarShards = 0;
  }

  private startStarShardsOrbitEffect() {
    if (this.starOrbitSfx) return;
    this.starOrbitSfx = SfxCmd.Create(StarShardsOrbitSfx, {
      scene: this.scene,
      baseDepth: this.baseDepth,
      viewGroup: this.viewGroup,
      getAnchor: () => ({
        x: this.x + this.offsetX,
        y: this.y + this.offsetY,
        active: !this.isDying,
      }),
    });
  }

  private stopStarShardsOrbitEffect() {
    this.starOrbitSfx?.stop();
    this.starOrbitSfx = null;
  }

  public override destroy() {
    this.stopStarShardsOrbitEffect();
    this.model.onDeath(this);
    const listeners = [...this.destroyListeners];
    this.destroyListeners.length = 0;
    listeners.forEach((listener) => listener(this));
    this.animController.destroy();
    this.attachSprites.forEach((sprite) => sprite.destroy());
    super.destroy();
  }
}


export type MonsterRank = "normal" | "elite" | "boss";

export type MonsterDefinition = {
  mid: number;
  nameKey: string;
  texturePath?: string;
  level: number;
  weight: (waveID: number) => number;
  leastWaveID?: number;
  leastWaveIDByStageID?: (stageID: number) => number;
  rank?: MonsterRank;
  maxHealth: number;
  baseSpeed: number;
  attackDamage: number;
  attackInterval?: number;
  isDefaultFlying?: boolean;
  isDefaultInVoid?: boolean;
  couldCarryStarShards?: boolean;
  createEntity: (scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) => MonsterEntity;
};

export class PresetMonsterModel extends MonsterModel {
  public readonly mid: number;
  public readonly nameKey: string;
  public readonly texturePath: string;
  public readonly level: number;
  public readonly weight: (waveID: number) => number;
  public readonly leastWaveID?: number;
  public readonly leastWaveIDByStageID?: (stageID: number) => number;
  public readonly rank: MonsterRank;
  public readonly maxHealth: number;
  public readonly baseSpeed: number;
  public readonly attackDamage: number;
  public readonly attackInterval: number;
  public readonly isDefaultFlying: boolean;
  public readonly isDefaultInVoid: boolean;
  public readonly couldCarryStarShards: boolean;

  private readonly entityFactory: MonsterDefinition["createEntity"];

  public constructor(def: MonsterDefinition) {
    super();
    this.mid = def.mid;
    this.nameKey = def.nameKey;
    this.texturePath = def.texturePath ?? "zombie/zombie";
    this.level = def.level;
    this.weight = def.weight;
    this.leastWaveID = def.leastWaveID;
    this.leastWaveIDByStageID = def.leastWaveIDByStageID;
    this.rank = def.rank ?? "normal";
    this.maxHealth = def.maxHealth;
    this.baseSpeed = def.baseSpeed;
    this.attackDamage = def.attackDamage;
    this.attackInterval = def.attackInterval ?? 1000;
    this.isDefaultFlying = def.isDefaultFlying ?? false;
    this.isDefaultInVoid = def.isDefaultInVoid ?? false;
    this.couldCarryStarShards = def.couldCarryStarShards ?? true;
    this.entityFactory = def.createEntity;
  }

  public getWeight(waveID: number): number {
    return this.weight(waveID);
  }

  public createEntity(scene: Game, col: number, row: number, waveID: number): MonsterEntity {
    return this.initializeEntity(this.entityFactory(scene, col, row, this, waveID));
  }
}

export abstract class BaseMonsterEntity extends MonsterEntity {
  declare public model: PresetMonsterModel;
  private readonly handAttachmentKeys = new Set<string>();
  private readonly fixedAttachmentOffsets = new Map<string, { x: number; y: number }>();

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
    this.ExtraData.waveId = waveID;
    this.currentHealth = model.maxHealth;
    this.health = model.maxHealth;
  }

  protected abstract createAnimController(): IMonsterAnimController;

  protected buildView(): void {
    if (this.animController) return;
    this.animController = this.createAnimController();
    this.animController.setDepth(this.baseDepth);
    this.animController.updatePosition(this.x + this.offsetX, this.y + this.offsetY);
    this.syncRegisteredAttachments();
  }

  public override updateView(vec: { x: number, y: number }): void {
    super.updateView(vec);
    this.syncRegisteredAttachments();
  }

  public registerHandAttachment(key: string) {
    this.handAttachmentKeys.add(key);
    this.syncHandAttachment(key);
  }

  public registerArmorAttachment(key: string) {
    this.registerFixedAttachment(key);
  }

  public registerShieldAttachment(key: string) {
    this.registerFixedAttachment(key);
  }

  private registerFixedAttachment(key: string) {
    const sprite = this.attachSprites.get(key);
    if (!sprite) return;

    this.fixedAttachmentOffsets.set(key, {
      x: sprite.x - (this.x + this.offsetX),
      y: sprite.y - (this.y + this.offsetY),
    });
    this.syncFixedAttachment(key);
  }

  private syncRegisteredAttachments() {
    this.handAttachmentKeys.forEach((key) => this.syncHandAttachment(key));
    this.fixedAttachmentOffsets.forEach((_offset, key) => this.syncFixedAttachment(key));
  }

  private syncHandAttachment(key: string) {
    const sprite = this.attachSprites.get(key);
    if (!sprite) return;

    const anchor = this.animController?.getHandAnchor?.() ?? {
      x: this.x + this.offsetX - PositionManager.Instance.GRID_SIZEX * 0.42,
      y: this.y + this.offsetY - PositionManager.Instance.GRID_SIZEY * 0.7,
    };
    sprite.setPosition(anchor.x, anchor.y);
  }

  private syncFixedAttachment(key: string) {
    const sprite = this.attachSprites.get(key);
    const offset = this.fixedAttachmentOffsets.get(key);
    if (!sprite || !offset) return;

    sprite.setPosition(this.x + this.offsetX + offset.x, this.y + this.offsetY + offset.y);
  }

  public getLegacyController() {
    return this.animController as LegacyMonsterAnimController<any> | undefined;
  }

  protected getAnimTargets() {
    return this.getLegacyController()?.getTargets() ?? [];
  }

  protected syncHealth() {
    this.health = this.currentHealth;
  }

  protected rawDamage(amount: number) {
    this.currentHealth -= amount;
    this.syncHealth();
    this.animController.highlight();

    if (this.currentHealth <= 0) {
      this.currentHealth = 0;
      this.syncHealth();
      this.ZombieDie();
      return;
    }

    if (amount > 10) {
      SoundCmd.PlayGeneralHit();
    }
  }

  public override takeDamage(amount: number, _dealer?: BaseEntity, _source?: BaseEntity): void {
    if (this.currentHealth <= 0 || this.isDying) return;
    this.rawDamage(amount);
  }

  protected onHurt(_amount: number, _realDamage: number, _dealer?: BaseEntity, _source?: BaseEntity): void { }

  protected onDeath(): void {
    this.ZombieDie();
  }

  protected override getDeathAnimationTargets(): Phaser.GameObjects.GameObject[] {
    return [...new Set([...this.getAnimTargets(), ...this.attachSprites.values()])];
  }
}

export abstract class StagedBodyMonsterEntity extends BaseMonsterEntity {
  // 破损程度分界点
  protected damageThresholds: number[] = [];
  private currentStage = -1;

  protected updateBodyDamageStage() {
    const raw = this.getLegacyController()?.raw as { switchBodyFrame?: (value: boolean | number) => void } | undefined;
    const fn = raw?.switchBodyFrame?.bind(raw);
    if (!fn || this.damageThresholds.length === 0) return;

    let stage = -1;
    for (let i = 0; i < this.damageThresholds.length; i++) {
      if (this.currentHealth <= this.damageThresholds[i]) {
        stage = i;
      }
    }
    if (stage === this.currentStage) return;
    this.currentStage = stage;

    if (this.damageThresholds.length === 1) {
      fn(stage >= 0);
      return;
    }

    fn(stage < 0 ? 0 : Math.min(stage + 1, this.damageThresholds.length));
  }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    super.takeDamage(amount, dealer, source);
    this.updateBodyDamageStage();
  }
}

export type ArmorConfig = {
  key: string;
  maxHealth: number;
  thresholds: number[];
  damageScale?: number;
  hitSound?: "ironHit" | "leatherHit";
  scale?: number;
  originX?: number;
  originY?: number;
  x?: number;
  y?: number;
  depth?: number;
};

export abstract class ArmorMonsterEntity extends StagedBodyMonsterEntity {
  protected armorHealth = 0;
  protected armorBroken = false;
  protected armorKey = "";
  protected armorConfig!: ArmorConfig;

  protected createArmor(config: ArmorConfig) {
    this.armorConfig = config;
    this.armorHealth = config.maxHealth;
    this.armorBroken = false;
    this.armorKey = config.key;

    const sprite = this.scene.add.sprite(
      this.x + this.offsetX + (config.x ?? 0),
      this.y + this.offsetY + (config.y ?? -PositionManager.Instance.GRID_SIZEY * 1.15),
      config.key,
    );
    sprite.setScale((config.scale ?? 1.4) * PositionManager.Instance.scaleFactor);
    sprite.setOrigin(config.originX ?? 0.5, config.originY ?? 0.5);
    sprite.setFrame(0).setDepth(DepthHelper.Mob.customAttachment(this.baseDepth, config.depth ?? 13));
    this.attachSprites.set(config.key, sprite);
    this.registerArmorAttachment(config.key);
  }

  protected updateArmorFrame() {
    if (this.armorBroken) return;
    const sprite = this.attachSprites.get(this.armorKey);
    if (!sprite) return;

    let frame = this.armorConfig.thresholds.length;
    for (let i = 0; i < this.armorConfig.thresholds.length; i++) {
      if (this.armorHealth > this.armorConfig.thresholds[i]) {
        frame = i;
        break;
      }
    }
    sprite.setFrame(frame);
  }

  protected onArmorBroken(_overflowDamage: number): void { }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (this.currentHealth <= 0 || this.isDying) return;

    if (!this.armorBroken && this.armorHealth > 0) {
      const real = amount * (this.armorConfig.damageScale ?? 1);
      if (this.armorHealth > real) {
        this.armorHealth -= real;
        this.animController.highlight();
        if (this.armorConfig.hitSound) {
          SoundCmd.PlayShieldHit(this.armorConfig.hitSound);
        }
        this.updateArmorFrame();
        return;
      }

      const overflow = Math.max(0, real - this.armorHealth);
      this.armorHealth = 0;
      this.armorBroken = true;
      this.attachSprites.get(this.armorKey)?.setVisible(false);
      this.onArmorBroken(overflow);
      if (overflow <= 0) return;
      super.takeDamage(overflow, dealer, source);
      return;
    }

    super.takeDamage(amount, dealer, source);
  }
}

export function addHandAttachment(entity: BaseMonsterEntity, key: string, scale = 1.4, depth = 13) {
  const sprite = entity.scene.add.sprite(
    entity.x + entity.offsetX - PositionManager.Instance.GRID_SIZEX * 0.42,
    entity.y - PositionManager.Instance.GRID_SIZEY * 0.7 + entity.offsetY,
    key,
  );
  sprite.setScale(scale * PositionManager.Instance.scaleFactor).setOrigin(0.5, 1).setDepth(DepthHelper.Mob.customAttachment(entity.baseDepth, depth));
  entity.attachSprites.set(key, sprite);
  entity.registerHandAttachment(key);
  return sprite;
}
